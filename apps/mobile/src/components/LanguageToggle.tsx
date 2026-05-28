import React from 'react';
import { Pressable } from 'react-native';
import { Text } from './Text';
import { useTranslation } from '../i18n';

/**
 * Compact EN/HE switch. Shows the language the user can switch TO,
 * so tapping it always flips to the other language.
 */
export function LanguageToggle({ className = '' }: { className?: string }) {
  const { lang, toggle } = useTranslation();
  return (
    <Pressable
      onPress={toggle}
      accessibilityRole="button"
      accessibilityLabel="Toggle language"
      className={`px-3.5 py-1.5 rounded-full border border-white/10 bg-white/[0.04] active:bg-white/[0.08] ${className}`}
    >
      <Text variant="caption" className="text-zinc-300 font-semibold">
        {lang === 'en' ? 'עברית' : 'English'}
      </Text>
    </Pressable>
  );
}
