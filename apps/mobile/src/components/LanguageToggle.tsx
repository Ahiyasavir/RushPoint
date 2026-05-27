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
      className={`px-3 py-1.5 rounded-full border border-zinc-700 bg-zinc-900 active:bg-zinc-800 ${className}`}
    >
      <Text variant="caption" className="text-zinc-300">
        {lang === 'en' ? 'עברית' : 'English'}
      </Text>
    </Pressable>
  );
}
