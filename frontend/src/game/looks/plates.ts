import { lookIn } from './frames.ts';

/** The collection a worn nameplate names, whose plate (`public/plates/<collection>.svg`) is laid behind its owner's name. */
export const plateOf = (nameplate: string | undefined) => lookIn('nameplate', nameplate);
