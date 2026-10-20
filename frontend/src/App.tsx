import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import AuthProvider from './components/AuthProvider'
import LoadingScreen from './components/LoadingScreen'
import RequireAuth from './components/RequireAuth'
import ScrollToTop from './components/ScrollToTop'
import { useAuth } from './lib/auth-context'
import { HOME_PATH_BY_ROLE } from './lib/roles'
import LoginPage from './pages/LoginPage'
import NotFoundPage from './pages/NotFoundPage'
import RegisterPage from './pages/RegisterPage'

// Role dashboards and management screens are split into their own chunks so
// the public sign-in flow does not download the whole application up front.
const AdminCalendarPage = lazy(() => import('./pages/admin/AdminCalendarPage'))
const AdminClassesPage = lazy(() => import('./pages/admin/AdminClassesPage'))
const AdminDepartmentsPage = lazy(() => import('./pages/admin/AdminDepartmentsPage'))
const AdminAuditPage = lazy(() => import('./pages/admin/AdminAuditPage'))
const AdminRegistrationsPage = lazy(() => import('./pages/admin/AdminRegistrationsPage'))
const AdminReportsPage = lazy(() => import('./pages/admin/AdminReportsPage'))
const AdminUsersPage = lazy(() => import('./pages/admin/AdminUsersPage'))
const AdminHome = lazy(() => import('./pages/dashboards/AdminHome'))
const FacultyHome = lazy(() => import('./pages/dashboards/FacultyHome'))
const HodHome = lazy(() => import('./pages/dashboards/HodHome'))
const StudentHome = lazy(() => import('./pages/dashboards/StudentHome'))
const FacultyClassPage = lazy(() => import('./pages/faculty/FacultyClassPage'))
const FacultyReportPage = lazy(() => import('./pages/faculty/FacultyReportPage'))
const FacultySessionPage = lazy(() => import('./pages/faculty/FacultySessionPage'))
const HodClassPage = lazy(() => import('./pages/hod/HodClassPage'))
const HodClassReportPage = lazy(() => import('./pages/hod/HodClassReportPage'))
const HodReportsPage = lazy(() => import('./pages/hod/HodReportsPage'))

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
        <ScrollToTop />
        <Suspense fallback={<LoadingScreen label="Loading page…" />}>
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
              path="/admin/calendar"
              element={
                <RequireAuth roles={['admin']}>
                  <AdminCalendarPage />
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
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  )
}
