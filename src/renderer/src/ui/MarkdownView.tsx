import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const normalizeExternalUrl = (url: string) => {
  const trimmed = url.trim()
  if (trimmed.startsWith('git+')) return trimmed.slice('git+'.length)
  if (trimmed.startsWith('git://')) return `https://${trimmed.slice('git://'.length)}`
  return trimmed
}

const openExternal = async (url: string) => {
  const normalized = normalizeExternalUrl(url)
  if (typeof window !== 'undefined' && typeof window.upm?.openExternal === 'function') {
    const res = await window.upm.openExternal(normalized)
    if (!res.ok) console.error(res.error)
    return
  }
  window.open(normalized, '_blank', 'noopener,noreferrer')
}

export const MarkdownView: React.FC<{ markdown: string }> = ({ markdown }) => {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...props }) => {
            const safeHref = typeof href === 'string' ? href : ''
            if (!safeHref) return <span {...props}>{children}</span>
            if (safeHref.startsWith('#')) {
              return (
                <a {...props} href={safeHref}>
                  {children}
                </a>
              )
            }
            return (
              <a
                {...props}
                href={safeHref}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  void openExternal(safeHref)
                }}
              >
                {children}
              </a>
            )
          }
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
}
