import { createContext, useState } from 'react';

export const ParticipationContext = createContext();

export function ParticipationProvider({ children }) {
  const [participation, setParticipation] = useState(null);

  return (
    <ParticipationContext.Provider value={{ participation, setParticipation }}>
      {children}
    </ParticipationContext.Provider>
  );
}
