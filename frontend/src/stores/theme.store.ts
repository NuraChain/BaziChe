import { createSignal, createStore } from 'azerothjs';

export type Theme = 'dark' | 'light';

const browserColour: Record<Theme, string> = { dark: '#0B1220', light: '#EDF2F7' };

export const useTheme = createStore(() =>
{
    const [theme, setTheme] = createSignal<Theme>(
        typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
    );

    const choose = (next: Theme) =>
    {
        setTheme(next);
        document.documentElement.dataset.theme = next;
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', browserColour[next]);
        const secure = location.protocol === 'https:' ? '; Secure' : '';
        document.cookie = `baziche-theme=${ next }; Path=/; Max-Age=31536000; SameSite=Lax${ secure }`;
    };

    return { theme, choose };
});
