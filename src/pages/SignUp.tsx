import { useEffect } from 'react';

export default function SignUp() {
  // Registration is currently disabled - redirect to ordefy.io
  useEffect(() => {
    window.location.href = 'https://ordefy.io';
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin mx-auto mb-4" />
        <p className="text-muted-foreground">Redirigiendo a ordefy.io...</p>
      </div>
    </div>
  );
}
