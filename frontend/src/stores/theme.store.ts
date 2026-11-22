import { createSignal, createStore } from 'azerothjs';

export type Theme = 'dark' | 'light';

export const useTheme = createStore(() =>
{
    const [theme, setTheme] = createSignal<Theme>(
        typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
    );

    const choose = (next: Theme) =>
    {
        setTheme(next);
        const root = document.documentElement;
        root.dataset.theme = next;
        const chrome = getComputedStyle(root).getPropertyValue('--void').trim();
        if (chrome)
        {
            document.querySelector('meta[name="theme-color"]')?.setAttribute('content', chrome);
        }
        const secure = location.protocol === 'https:' ? '; Secure' : '';
        document.cookie = `baziche-theme=${ next }; Path=/; Max-Age=31536000; SameSite=Lax${ secure }`;
    };

    return { theme, choose };
});
