import React from 'react';
export function LaplanceAppRoot({ authSession }) {
  const [user, setUser] = React.useState(() => authSession.getCurrentUser());
  React.useEffect(() => authSession.subscribe(setUser), [authSession]);
  return <main><h1>通常画面</h1><p>ログイン中: {user?.id ?? 'なし'}</p></main>;
}
