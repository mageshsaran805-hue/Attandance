import { useEffect } from 'react'
import { useLocation } from 'react-router'

/**
 * Resets the window scroll position when the route changes. In-page hash
 * links (for example the student section shortcuts) keep the same pathname
 * and are therefore left alone.
 */
export default function ScrollToTop() {
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return null
}
