import { createContext, useContext } from 'react';

// A visited view stays mounted until the document is reloaded.
export const ViewActive = createContext(true);
export const useViewActive = () => useContext(ViewActive);
