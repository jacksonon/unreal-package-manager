import React from 'react'

export const EmptyState: React.FC<{
  title: string
  description?: React.ReactNode
  children?: React.ReactNode
}> = ({ title, description, children }) => {
  return (
    <div className="ue-empty-wrap">
      <div className="ue-empty-state">
        <div className="ue-empty-icon" aria-hidden="true">
          空
        </div>
        <div className="ue-empty-title">{title}</div>
        {description ? <div className="ue-empty-desc">{description}</div> : null}
        {children ? <div className="ue-empty-extra">{children}</div> : null}
      </div>
    </div>
  )
}

