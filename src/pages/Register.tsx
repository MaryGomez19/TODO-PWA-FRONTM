import {useState} from 'react';
import {Link, useNavigate} from 'react-router-dom';
import {api, setAuth} from '../api';


export default function Register() {
    const nav = useNavigate();
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [show, setShow] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError("");
        setLoading(true);
        try {
            const {data} = await api.post('/auth/register', {name, email, password});
            localStorage.setItem('token', data.token);
            setAuth(data.token);
            nav('/dashboard');
        } catch (err: any) {
            setError(err.response?.data?.message || 'Error al registrar usuario');
        } finally {
            setLoading(false);
        }
    }

    return (
         <div className="auth-wrap">
            <div className="card">
                <h2>TO-DO</h2>
                <h2>Crea tu cuenta</h2>
                <form className="form" onSubmit={onSubmit}>
                    <label> Nombre</label>
                    <input 
                        type="text"
                        placeholder="Ingrese su nombre"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                    />
                    <label> Email</label>
                    <input 
                        type="email"
                        placeholder="Ingrese su email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                    />

                    <label> Constraseña </label>
                    <div className="pass">
                        <input
                            type={show ? "text" : "password"}
                            placeholder="Ingrese su contraseña"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                        />
                        <button 
                        type="button" 
                        className="ghost" 
                        onClick = {() => setShow((s) => !s)} 
                        aria-label="Mostrar / Ocultar contraseña"
                        />
                    </div>

                    {error && <p className="alert">{error}</p>}
                    <button className="btn btn-primary" disabled={loading}>
                        {loading ? 'Cargando...' : 'Guardar Registro'}
                    </button>
                </form>

                <div className="footer-links">
                    <span className="muted">¿Tienes una cuenta? </span>
                    <Link to="/">Inicia sesión</Link>
                </div>
            </div>
        </div>
    );
}