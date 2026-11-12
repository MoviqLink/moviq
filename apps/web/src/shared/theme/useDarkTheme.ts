import { useMediaQuery } from '../ui/useMediaQuery';
import { useThemeChoice } from './theme';

/** Whether the page is drawn dark now: chosen, or inherited from the system in `auto`. */
export function useDarkTheme(): boolean {
  const choice = useThemeChoice();
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
  return choice === 'dark' || (choice === 'auto' && systemDark);
}
