# Łódź Bus Times ⏰🚌

Una aplicación web progresiva (PWA) para ver tiempos de llegada de buses en tiempo real en Łódź, con cálculo automático de tiempo de caminata desde tu ubicación.

## Características

✅ **Tiempos en tiempo real** - Datos GTFS-RT de zbiorkom.live
✅ **Búsqueda de paradas** - Busca por nombre o ID
✅ **Paradas favoritas** - Guarda tus paradas más usadas
✅ **Cálculo de caminata** - Tiempo automático desde ubicación por defecto
✅ **Tiempo total** - Bus + caminata en una sola vista
✅ **PWA** - Funciona sin conexión con datos en caché
✅ **Responsive** - Funciona en móvil, tablet y desktop

## Requisitos

- Node.js 16+ 
- npm o yarn

## Instalación y uso

### 1. Clonar el repositorio
```bash
git clone <repo-url>
cd lodz-bus
```

### 2. Instalar dependencias
```bash
# Frontend
npm install

# Backend
cd backend-lodz
npm install
cd ..
```

### 3. Configuración

#### Backend
```bash
cd backend-lodz
cp .env.example .env
# Editar .env si es necesario (Puerto, ubicación por defecto)
```

#### Frontend
```bash
cp .env.example .env.local
# Editar .env.local si es necesario (URL del backend)
```

### 4. Ejecutar

**Terminal 1 - Backend:**
```bash
cd backend-lodz
npm run dev
# Escuchará en http://localhost:3000
```

**Terminal 2 - Frontend:**
```bash
npm run dev
# Escuchará en http://localhost:5173
```

Abre http://localhost:5173 en tu navegador.

## Producción

### Build
```bash
npm run build
```

### Deploy

**Backend (Node.js):**
```bash
cd backend-lodz
npm install --production
npm start
```

**Frontend (servir archivos estáticos):**
Los archivos en `dist/` pueden ser servidos por cualquier servidor web estático (Nginx, Apache, Vercel, Netlify, etc.)

## Arquitectura

### Backend (`backend-lodz/`)
- **Express.js** - Servidor HTTP
- **GTFS-RT** - Datos en tiempo real de buses
- Endpoints:
  - `GET /stops/search?q=query` - Buscar paradas
  - `GET /stop-departures?stop_id=X` - Ver buses en una parada
  - `GET /routes` - Listar líneas disponibles
  - `POST /walking-time` - Calcular tiempo de caminata
  - `GET /api/app-state` - Estado persistente (enlaces/fotos)
  - `PUT /api/app-state` - Guardar estado persistente
  - `POST /api/cache-image` - Cachear imágenes (Pinterest)
  - `GET /cached-images/:file` - Servir imágenes cacheadas

## Deploy gratis (sin tener el PC encendido)

Objetivo: que funcione en móvil/iPad 24/7.

### Opción recomendada (gratis):
- **Frontend**: Cloudflare Pages (gratis)
- **Backend**: Render (free web service)

> Nota: en free tier, Render puede “dormirse” tras inactividad y tarda unos segundos en despertar.

### 1) Backend en Render
1. Sube este repo a GitHub.
2. Copia la carpeta `lodz/` (stops.txt, routes.txt, trips.txt, stop_times.txt, etc.) dentro del repo para que el backend tenga datos estáticos en producción.
3. En Render crea un **Web Service** apuntando a `backend-lodz`.
4. Configura:
  - Build command: `npm install`
  - Start command: `npm start`
5. Variables de entorno mínimas:
  - `PORT=3000`
  - `GTFS_DIR=/opt/render/project/src/lodz`
6. Publica y copia la URL del backend (ej: `https://tu-backend.onrender.com`).

### 2) Frontend en Cloudflare Pages
1. En Cloudflare Pages conecta el repo.
2. Configura:
  - Build command: `npm run build`
  - Build output: `dist`
3. Variable de entorno:
  - `VITE_API_URL=https://tu-backend.onrender.com`
4. Publica y abre la URL en móvil/iPad.

### 3) Persistencia (enlaces + fotos Pinterest)
- El tablero usa `PUT /api/app-state` para guardar enlaces en servidor.
- Las imágenes de Pinterest se guardan en backend vía `POST /api/cache-image` y quedan en `/cached-images/...`.
- Así no dependes del navegador local del dispositivo.

### Azure con cuenta de estudiante (alternativa)
Si prefieres Microsoft:
- Frontend: Azure Static Web Apps
- Backend: Azure App Service (Node)

Con créditos de Azure for Students, puedes mantenerlo siempre encendido sin usar tu PC.

### Frontend (`src/`)
- **React 19** - UI
- **TypeScript** - Type safety
- **Vite** - Build tool
- **Lucide Icons** - Iconografía
- **Service Worker** - PWA offline

#### Componentes principales:
- `StopSearch` - Búsqueda de paradas con favoritos
- `BusList` - Lista de buses con tiempos
- `App` - Componente principal

#### Servicios:
- `services/api.ts` - Cliente HTTP para backend
- `services/favorites.ts` - Gestión de localStorage
- `hooks/useServiceWorker.ts` - Registro de service worker

## Configuración de ubicación

La ubicación por defecto para cálculo de caminata es el centro de Łódź (Piotrkowska:
- Latitud: 51.7748
- Longitud: 19.4474

Puedes cambiarla en:
1. Backend: `backend-lodz/index.js` - Variables `DEFAULT_USER_LAT` y `DEFAULT_USER_LON`
2. O pasar `USER_LAT` y `USER_LON` como variables de entorno

## Datos

La aplicación utiliza datos públicos de:
- **GTFS-RT**: https://cdn.zbiorkom.live/gtfs-rt/lodz.pb
- **Paradas estáticas**: Extraídas del feed GTFS-RT

## Browser support

- Chrome/Edge 50+
- Firefox 45+
- Safari 11+ (iOS 12+)
- Samsung Internet 5+

## Desarrollo

### Tecnologías
- **React 19** - UI framework
- **TypeScript** - Type checking
- **Vite** - Build tool
- **Lucide React** - Icons
- **CSS3** - Styling

### Comandos útiles
```bash
npm run dev          # Desarrollo con HMR
npm run build        # Build para producción
npm run preview      # Preview del build
npm run lint         # Ejecutar ESLint
```

## PWA Features

La app está configurada como PWA con:
- ✅ Manifest.json
- ✅ Service Worker para caché offline
- ✅ Icons para distintos dispositivos
- ✅ Installable en home screen
- ✅ Standalone mode (sin barra del navegador)

### Instalar como app
1. Abre la app en tu navegador
2. Click en el menú (⋮)
3. Selecciona "Instalar app" o "Agregar a pantalla de inicio"

## Contribuir

Las contribuciones son bienvenidas. Por favor:
1. Fork el repositorio
2. Crea una rama para tu feature
3. Commit tus cambios
4. Push a la rama
5. Abre un Pull Request

## Licencia

MIT

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
