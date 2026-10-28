// Extiende las simulaciones anteriores con carpetas ya vinculadas.
export const conCarpetas = handler => async (url, options = {}) => {
  const u = new URL(String(url));
  const q = u.searchParams.get('q') || '';
  if (u.pathname === '/drive/v3/files' && q.includes("mimeType = 'application/vnd.google-apps.folder'")) {
    return Response.json({ files: [{ id: 'carpeta-paciente', appProperties: { clidanfi_paciente: 'paciente' } }] });
  }
  if (u.pathname === '/drive/v3/files' && q.includes("not appProperties has { key='clidanfi_carpeta'")) return Response.json({ files: [] });
  const response = await handler(url, options);
  if (u.pathname === '/drive/v3/files' && response.ok && !options.method) {
    const data = await response.json();
    return Response.json({ ...data, files: (data.files || []).map(f => ({ ...f,
      parents: ['carpeta-paciente'], appProperties: { ...f.appProperties, clidanfi_paciente: 'paciente', clidanfi_carpeta: '1' } })) });
  }
  return response;
};
