import type { ReactNode } from 'react'
import { activityDestinations } from './activityNavigationModel'
import type { ActivityDestination, ActivityId } from './activityNavigationModel'

type ActivityNavigationProps = {
  active: ActivityId
  variant: 'rail' | 'mobile'
  onSelect: (destination: ActivityDestination) => void
  children?: ReactNode
}

function ActivityIcon({ id }: { id: ActivityId }) {
  if (id === 'files') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5h6l2 2h9v10h-17z" /></svg>
  }
  if (id === 'search') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 5 5" /></svg>
  }
  if (id === 'graph') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="7" r="2.25" /><circle cx="18" cy="6" r="2.25" /><circle cx="12" cy="18" r="2.25" /><path d="m8 7 7.75-.75M7.25 9l3.5 6.75M16.75 8l-3.5 7.75" /></svg>
  }
  if (id === 'outline') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14M5 12h10M8 18h11" /></svg>
  }
  if (id === 'diagrams') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="6" height="5" rx="1" /><rect x="14.5" y="15.5" width="6" height="5" rx="1" /><path d="M9.5 6h3a3 3 0 0 1 3 3v5.5" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 14.5 7 17a3.5 3.5 0 0 1-5-5l3-3a3.5 3.5 0 0 1 5 0M14.5 9.5 17 7a3.5 3.5 0 0 1 5 5l-3 3a3.5 3.5 0 0 1-5 0M8.5 15.5l7-7" /></svg>
}

export default function ActivityNavigation({ active, variant, onSelect, children }: ActivityNavigationProps) {
  return (
    <nav className={variant === 'rail' ? 'activity-rail desktop-only' : 'mobile-activity-nav mobile-only'} aria-label={variant === 'rail' ? 'Workspace activities' : 'Workspace navigation'}>
      {activityDestinations.map((destination) => (
        <button
          key={destination.id}
          type="button"
          className={`activity-button ${active === destination.id ? 'active' : ''}`}
          aria-label={destination.label}
          aria-current={active === destination.id ? 'page' : undefined}
          title={destination.label}
          onClick={() => onSelect(destination)}
        >
          <ActivityIcon id={destination.id} />
          <span className="activity-label">{destination.label}</span>
        </button>
      ))}
      {children}
    </nav>
  )
}
