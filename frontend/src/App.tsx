import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import AuthProvider from './components/AuthProvider'
import LoadingScreen from './components/LoadingScreen'
import RequireAuth from './components/RequireAuth'
import { useAuth } from './lib/auth-context'
import { HOME_PATH_BY_ROLE } from './lib/roles'
import AdminClassesPage from './pages/admin/AdminClassesPage'
import AdminDepartmentsPage from './pages/admin/AdminDepartmentsPage'
import AdminAuditPage from './pages/admin/AdminAuditPage'
import AdminRegistrationsPage from './pages/admin/AdminRegistrationsPage'
import AdminReportsPage from './pages/admin/AdminReportsPage'
import AdminUsersPage from './pages/admin/AdminUsersPage'
import AdminHome from './pages/dashboards/AdminHome'
import FacultyHome from './pages/dashboards/FacultyHome'
import HodHome from './pages/dashboards/HodHome'
import StudentHome from './pages/dashboards/StudentHome'
import FacultyClassPage from './pages/faculty/FacultyClassPage'
import FacultyReportPage from './pages/faculty/FacultyReportPage'
import FacultySessionPage from './pages/faculty/FacultySessionPage'
import HodClassPage from './pages/hod/HodClassPage'
import HodClassReportPage from './pages/hod/HodClassReportPage'
import HodReportsPage from './pages/hod/HodReportsPage'
import LoginPage from './pages/LoginPage'
import NotFoundPage from './pages/NotFoundPage'
import RegisterPage from './pages/RegisterPage'

function RootRedirect() {
  const { user, status } = useAuth()

  if (status === 'loading') {
    return <LoadingScreen label="Checking your session…" />
  }
  return <Navigate to={user ? HOME_PATH_BY_ROLE[user.role] : '/login'} replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          <Route
            path="/admin"
            element={
              <RequireAuth roles={['admin']}>
                <AdminHome />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/departments"
            element={
              <RequireAuth roles={['admin']}>
                <AdminDepartmentsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/classes"
            element={
              <RequireAuth roles={['admin']}>
                <AdminClassesPage />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/users"
            element={
              <RequireAuth roles={['admin']}>
                <AdminUsersPage />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/registrations"
            element={
              <RequireAuth roles={['admin']}>
                <AdminRegistrationsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/reports"
            element={
              <RequireAuth roles={['admin']}>
                <AdminReportsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/audit"
            element={
              <RequireAuth roles={['admin']}>
                <AdminAuditPage />
              </RequireAuth>
            }
          />

          <Route
            path="/hod"
            element={
              <RequireAuth roles={['hod']}>
                <HodHome />
              </RequireAuth>
            }
          />
          <Route
            path="/hod/classes/:classId"
            element={
              <RequireAuth roles={['hod']}>
                <HodClassPage />
              </RequireAuth>
            }
          />
          <Route
            path="/hod/reports"
            element={
              <RequireAuth roles={['hod']}>
                <HodReportsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/hod/classes/:classId/report"
            element={
              <RequireAuth roles={['hod']}>
                <HodClassReportPage />
              </RequireAuth>
            }
          />

          <Route
            path="/faculty"
            element={
              <RequireAuth roles={['faculty']}>
                <FacultyHome />
              </RequireAuth>
            }
          />
          <Route
            path="/faculty/classes/:classId"
            element={
              <RequireAuth roles={['faculty']}>
                <FacultyClassPage />
              </RequireAuth>
            }
          />
          <Route
            path="/faculty/sessions/:sessionId"
            element={
              <RequireAuth roles={['faculty']}>
                <FacultySessionPage />
              </RequireAuth>
            }
          />
          <Route
            path="/faculty/classes/:classId/report"
            element={
              <RequireAuth roles={['faculty']}>
                <FacultyReportPage />
              </RequireAuth>
            }
          />

          <Route
            path="/student"
            element={
              <RequireAuth roles={['student']}>
                <StudentHome />
              </RequireAuth>
            }
          />

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
