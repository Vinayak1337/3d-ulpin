import { createBrowserRouter, Navigate } from 'react-router';
import { Frame } from './Frame';
import { BatchesPage } from '../features/batches/BatchesPage';
import { PlannedPage } from '../features/placeholder/PlannedPage';
import { NotFoundPage } from '../features/placeholder/NotFoundPage';

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
      { path: 'registry', element: <PlannedPage title="Register" milestone="M4" /> },
      { path: 'registry/*', element: <PlannedPage title="Register" milestone="M4" /> },
      { path: 'properties/:buildingId/register', element: <PlannedPage title="Register" milestone="M4" /> },
      { path: 'datasets/*', element: <PlannedPage title="Dataset" milestone="M5" /> },
      { path: 'cases/*', element: <PlannedPage title="Workspace review" milestone="M5" /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);
