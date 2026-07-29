import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { ToastProvider } from './context/ToastContext';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import App from './App';
import Dashboard from './pages/Dashboard';
import AuctionDetail from './pages/AuctionDetail';
import MyBids from './pages/MyBids';
import Admin from './pages/Admin';
import Login from './pages/Login';
import './index.css';

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      {
        index: true,
        element: (
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        ),
      },
      {
        path: 'auction/:id',
        element: (
          <ProtectedRoute>
            <AuctionDetail />
          </ProtectedRoute>
        ),
      },
      {
        path: 'my-bids',
        element: (
          <ProtectedRoute>
            <MyBids />
          </ProtectedRoute>
        ),
      },
      {
        path: 'admin',
        element: (
          <ProtectedRoute>
            <Admin />
          </ProtectedRoute>
        ),
      },
      { path: 'login', element: <Login /> },
    ],
  },
]);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthProvider>
  </StrictMode>
);
