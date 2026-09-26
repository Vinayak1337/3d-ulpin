import { createBrowserRouter, Navigate } from 'react-router';
import { Frame } from './Frame';
import { BatchesPage } from '../features/batches/BatchesPage';
import { PlannedPage } from '../features/placeholder/PlannedPage';
import { NotFoundPage } from '../features/placeholder/NotFoundPage';
import { VerifyPage } from '../features/verify/VerifyPage';

/** Saved-link scheme kept from the previous Studio (H99): /studio/work, /studio/areas/:areaId, ... */
export const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/studio/work" replace /> },
  { path: '/studio', element: <Navigate to="/studio/work" replace /> },
  {
    path: '/studio',
    element: <Frame />,
    children: [
      { path: 'work', element: <BatchesPage /> },
      // The map pulls in Three.js; load it only when a map route opens.
      { path: 'map', lazy: async () => ({ Component: (await import('../features/map/MapPage')).MapIndexRedirect }) },
      { path: 'areas/:areaId', lazy: async () => ({ Component: (await import('../features/map/MapPage')).MapPage }) },
      { path: 'add-files', element: <PlannedPage title="Add files" milestone="M5" /> },
      { path: 'registry', lazy: async () => ({ Component: (await import('../features/register/RegistryIndex')).RegistryIndex }) },
      { path: 'registry/*', element: <Navigate to="/studio/registry" replace /> },
      { path: 'properties/:buildingId/register', lazy: async () => ({ Component: (await import('../features/register/RegisterPage')).RegisterPage }) },
      { path: 'datasets/*', element: <PlannedPage title="Dataset" milestone="M5" /> },
      { path: 'cases/*', element: <PlannedPage title="Workspace review" milestone="M5" /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  // P4L: the card's QR opens this on the same device, outside the Studio frame.
  { path: '/verify/:code', element: <VerifyPage /> },
  { path: '*', element: <NotFoundPage /> },
]);
