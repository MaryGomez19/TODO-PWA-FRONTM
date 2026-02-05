import axios from 'axios';
export const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5555/api',
});

export function setAuth(token: string | null) {
    if (token) {
        api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    } else {
        delete api.defaults.headers.common['Authorization'];
    }
}

setAuth(localStorage.getItem('token'));

//Si el token expira o es invalido, eliminar el token y redirigir al login

api.interceptors.response.use(
    (r) => r,
    (error) => {
        if (error.response ?.status === 401) {
            localStorage.removeItem('token');
            setAuth(null);
            window.location.href = '/login';
        }
        return Promise.reject(error);
    }
);