import React, { createContext, useContext, useMemo, useState } from 'react'
import { createTranslator, resolveLanguage } from '@shared/i18n'
import type { MessageKey, ResolvedLanguage, UiLanguage } from '@shared/i18n'

type Vars = Record<string, string | number>

export type Translate = (key: MessageKey, vars?: Vars) => string

const I18nContext = createContext<{
  pref: UiLanguage
  setPref: (pref: UiLanguage) => void
  lang: ResolvedLanguage
  t: Translate
} | null>(null)

const getBrowserLocales = (): string[] => {
  if (typeof navigator === 'undefined') return []
  const langs = Array.isArray(navigator.languages) ? navigator.languages : []
  const primary = typeof navigator.language === 'string' ? [navigator.language] : []
  return [...langs, ...primary].filter(Boolean)
}

export const I18nProvider: React.FC<{
  children: React.ReactNode
}> = ({ children }) => {
  const [pref, setPref] = useState<UiLanguage>('system')
  const locales = getBrowserLocales()
  const lang = useMemo(() => resolveLanguage(pref, locales), [pref, locales.join('|')])
  const t = useMemo(() => createTranslator(lang), [lang])

  return <I18nContext.Provider value={{ pref, setPref, lang, t }}>{children}</I18nContext.Provider>
}

export const useI18n = () => {
  const v = useContext(I18nContext)
  if (!v) throw new Error('useI18n must be used within I18nProvider')
  return v
}
