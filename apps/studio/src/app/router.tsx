import { createBrowserRouter, Navigate } from 'react-router';
import { Frame } from './Frame';
import { PageError } from './PageError';
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
      // A render error in a page stays inside the frame: the header and navigation remain.
      {
        errorElement: <PageError />,
        children: [
          { path: 'work', element: <BatchesPage /> },
          {
            path: 'work/cases/:caseId/tables/:sourceId',
            lazy: async () => ({ Component: (await import('../features/intake/table/TablePage')).TablePage }),
          },
          // The map pulls in Three.js; load it only when a map route opens.
          {
            path: 'map',
            lazy: async () => ({ Component: (await import('../features/map/MapPage')).MapIndexRedirect }),
          },
          {
            path: 'areas/:areaId',
            lazy: async () => ({ Component: (await import('../features/map/MapPage')).MapPage }),
          },
          {
            path: 'areas/:areaId/candidates',
            lazy: async () => ({
              Component: (await import('../features/review/candidates/CandidateReviewPage')).AreaCandidatesPage,
            }),
          },
          {
            path: 'properties/:buildingId/candidates',
            lazy: async () => ({
              Component: (await import('../features/review/candidates/CandidateReviewPage')).BuildingCandidatesPage,
            }),
          },
          {
            path: 'add-files',
            lazy: async () => ({ Component: (await import('../features/intake/AddFilesRoute')).AddFilesRoute }),
          },
          {
            path: 'registry',
            lazy: async () => ({ Component: (await import('../features/register/RequestsPage')).RegistryIndex }),
          },
          { path: 'registry/*', element: <Navigate to="/studio/registry" replace /> },
          {
            path: 'properties/:buildingId/register',
            lazy: async () => ({ Component: (await import('../features/register/RegisterPage')).RegisterPage }),
          },
          {
            path: 'review/:buildingId',
            lazy: async () => ({ Component: (await import('../features/review/WorkspacePage')).WorkspacePage }),
          },
          { path: 'datasets/*', element: <PlannedPage title="Dataset" milestone="M5" /> },
          { path: 'cases/*', element: <PlannedPage title="Workspace review" milestone="M5" /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
  // Public portal: search, buildings and released records, the public map, card verification, requests. No sign-in.
  {
    path: '/portal',
    lazy: async () => ({ Component: (await import('../portal/PortalFrame')).PortalFrame }),
    children: [
      // A render error in a portal page stays inside the portal frame: its header and footer remain.
      {
        errorElement: <PageError />,
        children: [
          { index: true, lazy: async () => ({ Component: (await import('../portal/HomePage')).HomePage }) },
          { path: 'search', lazy: async () => ({ Component: (await import('../portal/ResultsPage')).ResultsPage }) },
          {
            path: 'records/:recordId',
            lazy: async () => ({ Component: (await import('../portal/RecordPage')).RecordPage }),
          },
          {
            path: 'buildings/:buildingId',
            lazy: async () => ({ Component: (await import('../portal/BuildingPage')).BuildingPage }),
          },
          { path: 'request', lazy: async () => ({ Component: (await import('../portal/RequestPage')).RequestPage }) },
          { path: 'track', lazy: async () => ({ Component: (await import('../portal/TrackPage')).TrackPage }) },
          { path: 'map', lazy: async () => ({ Component: (await import('../portal/PublicMapPage')).PublicMapIndex }) },
          {
            path: 'map/:areaId',
            lazy: async () => ({ Component: (await import('../portal/PublicMapPage')).PublicMapPage }),
          },
          { path: 'verify', lazy: async () => ({ Component: (await import('../portal/VerifyPortal')).VerifyPortal }) },
        ],
      },
    ],
  },
  // The card's QR opens this, outside the Studio frame.
  { path: '/verify/:code', element: <VerifyPage /> },
  { path: '*', element: <NotFoundPage /> },
]);
