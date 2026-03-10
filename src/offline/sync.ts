import { api } from "../api";
import {
  getOutbox,
  clearOutbox,
  setMapping,
  getMapping,
  removeTaskLocal,
  promoteLocalToServer,
} from "./db";

let syncing = false;          // <-- evita syncs en paralelo
let lastSyncAt = 0;           // <-- cool-down simple

async function uploadPendingImage(imagePending: string): Promise<{ url: string; publicId: string } | null> {
  try {
    // Convertir base64 a blob directamente sin fetch
    const arr = imagePending.split(',');
    const mime = arr[0].match(/:(.*?);/)?.[1] ?? 'image/png';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) u8arr[n] = bstr.charCodeAt(n);
    const blob = new Blob([u8arr], { type: mime });

    const isPDF = mime === 'application/pdf';
    const uploadUrl = isPDF
      ? "https://api.cloudinary.com/v1_1/dfrnbcqs0/raw/upload"
      : "https://api.cloudinary.com/v1_1/dfrnbcqs0/image/upload";

    const formData = new FormData();
    const extension = mime === 'application/pdf' ? '.pdf' : '.png';
    const fileName = `archivo${extension}`;
    formData.append("file", blob, fileName);
    formData.append("upload_preset", "react_uploads");

    const upload = await fetch(uploadUrl, { method: "POST", body: formData });
    const result = await upload.json();
    return { url: result.secure_url, publicId: result.public_id ?? "" };
  } catch {
    return null;
  }
}

export async function syncNow() {
  if (!navigator.onLine) return;

  // evita ráfagas múltiples (por ejemplo, varios eventos "online")
  const now = Date.now();
  if (now - lastSyncAt < 1500) return;
  lastSyncAt = now;

  if (syncing) return;
  syncing = true;

  try {
    const ops = (await getOutbox() as any[]).sort((a, b) => a.ts - b.ts);
    if (!ops.length) return;

    // 1) Armar lote para bulksync (create + update con clienteId)
    const toSync: any[] = [];
    for (const op of ops) {
      if (op.op === "create") {
        let imageUrl = op.data.image;
        let imagePublicId = op.data.imagePublicId ?? "";

        // Si tiene imagen pendiente (base64), subirla ahora
        if (op.data.imagePending) {
          const uploaded = await uploadPendingImage(op.data.imagePending);
          if (uploaded) {
            imageUrl = uploaded.url;
            imagePublicId = uploaded.publicId;
            // Actualizar la tarea local con la URL real
            await promoteLocalToServer(op.clienteId, op.clienteId); 
          }
        }
        toSync.push({
          clienteId: op.clienteId,
          title: op.data.title,
          description: op.data.description ?? "",
          status: op.data.status ?? "Pendiente",
          image: imageUrl,
          imagePublicId,
        });
      } else if (op.op === "update") {
        // si hay clienteId, va en bulksync; si hay serverId, va por PUT directo
        const cid = op.clienteId;
        let imageUrl = op.data.image;
        let imagePublicId = op.data.imagePublicId ?? "";

        if (op.data.imagePending) {
          const uploaded = await uploadPendingImage(op.data.imagePending);
          if (uploaded) {
            imageUrl = uploaded.url;
            imagePublicId = uploaded.publicId;
          } else {
            imageUrl = null;
          }
        }

        if (cid) {
          toSync.push({
            clienteId: cid,
            title: op.data.title,
            description: op.data.description,
            status: op.data.status,
            image: imageUrl,
            imagePublicId,
          });
        } else if (op.serverId) {
          try {
            const imageToSend = imageUrl?.startsWith('data:') ? null : imageUrl;
            await api.put(`/tasks/${op.serverId}`, { 
              title: op.data.title,
              description: op.data.description,
              status: op.data.status,
              image: imageToSend,  // <- nunca manda base64
              imagePublicId 
            });
          } catch {
            /* reintenta en próxima vuelta */
          }
        }
      }
    }

    // 2) Ejecutar bulksync y "promover" IDs locales a serverId
    if (toSync.length) {
      try {
        const { data } = await api.post("/tasks/bulksync", { tasks: toSync });
        for (const map of data?.mapping || []) {
          await setMapping(map.clienteId, map.serverId);
          await promoteLocalToServer(map.clienteId, map.serverId); // _id => serverId, pending=false
        }
      } catch {
        // si falla bulksync, salimos sin limpiar outbox para reintento
        return;
      }
    }

    // 3) Procesar deletes (requiere serverId; si aún no hay mapeo, se reintenta luego)
    for (const op of ops) {
      if (op.op !== "delete") continue;
      const serverId =
        op.serverId ?? (op.clienteId ? await getMapping(op.clienteId) : undefined);
      if (!serverId) continue;
      try {
        await api.delete(`/tasks/${serverId}`);
        await removeTaskLocal(op.clienteId || serverId);
      } catch {
        /* ignorar; se reintenta */
      }
    }

    // 4) Si todo lo anterior no arrojó errores "bloqueantes", limpiamos outbox
    await clearOutbox();
  } finally {
    syncing = false;
  }
}

/** Suscripción: dispara sync al reconectar (usa UNO solo en tu app) */
export function setupOnlineSync() {
  const handler = () => {
    void syncNow();
  };
  window.addEventListener("online", handler);
  return () => window.removeEventListener("online", handler);
}