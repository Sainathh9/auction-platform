import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { ToastProvider } from './context/ToastContext';
import App from './App';
import Dashboard from './pages/Dashboard';
import AuctionDetail from './pages/AuctionDetail';
import MyBids from './pages/MyBids';
import Admin from './pages/Admin';
import './index.css';

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'auction/:id', element: <AuctionDetail /> },
      { path: 'my-bids', element: <MyBids /> },
      { path: 'admin', element: <Admin /> },
    ],
  },
]);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>
  </StrictMode>
);
