import React from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGE_STORAGE_KEY, SUPPORTED_LANGUAGES } from '@renderer/lib/i18n';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { SettingRow } from './SettingRow';

const LanguageCard: React.FC = () => {
  const { t, i18n } = useTranslation();
  const current = SUPPORTED_LANGUAGES.find((lng) => i18n.language?.startsWith(lng)) ?? 'zh-CN';

  const handleChange = (next: string | null) => {
    if (!next) return;
    void i18n.changeLanguage(next);
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  };

  return (
    <SettingRow
      title={t('settings.language.title')}
      description={t('settings.language.description')}
      control={
        <div className="w-[183px] shrink-0">
          <Select value={current} onValueChange={handleChange}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_LANGUAGES.map((lng) => (
                <SelectItem key={lng} value={lng}>
                  {t(`language.${lng}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
    />
  );
};

export default LanguageCard;
