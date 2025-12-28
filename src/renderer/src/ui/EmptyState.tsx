import React from 'react'

export const EmptyState: React.FC<{
  icon?: React.ReactNode
  title: string
  description?: React.ReactNode
  children?: React.ReactNode
}> = ({ icon, title, description, children }) => {
  return (
    <div className="ue-empty-wrap">
      <div className="ue-empty-state">
        {typeof icon !== 'undefined' ? (
          <div className="ue-empty-icon" aria-hidden="true">
            {icon}
          </div>
        ) : null}
        <div className="ue-empty-title">{title}</div>
        {description ? <div className="ue-empty-desc">{description}</div> : null}
        {children ? <div className="ue-empty-extra">{children}</div> : null}
      </div>
    </div>
  )
}
