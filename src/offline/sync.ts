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
        toSync.push({
          clienteId: op.clienteId,
          title: op.data.title,
          description: op.data.description ?? "",
          status: op.data.status ?? "Pendiente",
        });
      } else if (op.op === "update") {
        // si hay clienteId, va en bulksync; si hay serverId, va por PUT directo
        const cid = op.clienteId;
        if (cid) {
          toSync.push({
            clienteId: cid,
            title: op.data.title,
            description: op.data.description,
            status: op.data.status,
          });
        } else if (op.serverId) {
          try {
            await api.put(`/tasks/${op.serverId}`, op.data);
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