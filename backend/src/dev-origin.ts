/**
 * Where `npm run dev` serves the browser: vite on this port and no other (`frontend/vite.config.ts`),
 * so in development the browser's origin is known, and the `.env` written for `npm start` serves
 * both commands.
 */
export const DEV_PORT = 3100;

export const DEV_ORIGIN = `http://localhost:${ DEV_PORT }`;
