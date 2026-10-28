(function (global) {
  'use strict';
  const vistos = new Set(), observados = new Set(), pulsaciones = new WeakMap();
  const reducir = global.matchMedia?.('(prefers-reduced-motion: reduce)');
  const recordar = clave => { vistos.add(clave); if (vistos.size > 1500) vistos.delete(vistos.values().next().value); };
  const mostrar = elemento => {
    const clave = elemento.dataset.motionKey;
    if (reducir?.matches || vistos.has(clave)) { elemento.dataset.motionState = 'ready'; return; }
    recordar(clave);
    elemento.dataset.motionState = 'entering';
    const fill = elemento.querySelector('.motion-meter-fill');
    if (!fill) { elemento.dataset.motionState = 'ready'; return; }
    const terminar = evento => {
      if (evento.animationName !== 'meter-charge') return;
      elemento.dataset.motionState = 'ready';
      fill.removeEventListener('animationend', terminar);
    };
    fill.addEventListener('animationend', terminar);
  };
  const observer = global.IntersectionObserver ? new global.IntersectionObserver(entradas => {
    for (const entrada of entradas) {
      const elemento = entrada.target;
      elemento.dataset.motionVisible = entrada.isIntersecting ? 'true' : 'false';
      if (entrada.isIntersecting && entrada.intersectionRatio >= .25 && elemento.dataset.motionState === 'pending') mostrar(elemento);
    }
  }, { threshold: [0, .25] }) : null;
  const registrar = elemento => {
    if (observados.has(elemento)) return;
    observados.add(elemento);
    elemento.dataset.motionState = reducir?.matches || vistos.has(elemento.dataset.motionKey) || !observer ? 'ready' : 'pending';
    elemento.dataset.motionVisible = observer ? 'false' : 'true';
    observer?.observe(elemento);
  };
  const explorar = nodo => {
    if (nodo.nodeType !== 1) return;
    if (nodo.matches('[data-motion-key]')) registrar(nodo);
    nodo.querySelectorAll('[data-motion-key]').forEach(registrar);
  };
  const presionar = evento => {
    if (reducir?.matches || (evento.type === 'keydown' && (evento.repeat || !['Enter', ' '].includes(evento.key)))) return;
    if (evento.type === 'pointerdown' && evento.button !== 0) return;
    const boton = evento.target.closest('button, a[data-action], .nav-side, .agenda-cell, .patient-session-row');
    if (!boton || boton.matches(':disabled, [aria-disabled="true"]') || !boton.animate) return;
    pulsaciones.get(boton)?.cancel();
    const estilo = global.getComputedStyle(boton), base = estilo.transform === 'none' ? '' : estilo.transform;
    const sombra = estilo.boxShadow;
    const animacion = boton.animate([
      { transform: `${base} scale(1)`, boxShadow: sombra },
      { transform: `${base} scale(.975, .93)`, boxShadow: 'inset 0 3px 8px rgba(29,48,45,.2)', offset: .3 },
      { transform: `${base} scale(1.008, 1.015)`, boxShadow: sombra, offset: .7 },
      { transform: `${base} scale(1)`, boxShadow: sombra }
    ], { duration: 320, easing: 'cubic-bezier(.22,.7,.28,1)' });
    pulsaciones.set(boton, animacion);
  };
  const instalar = () => {
    explorar(document.body);
    const cambios = new MutationObserver(mutaciones => {
      for (const m of mutaciones) for (const nodo of m.addedNodes) explorar(nodo);
      for (const elemento of observados) if (!elemento.isConnected) { observer?.unobserve(elemento); observados.delete(elemento); }
    });
    cambios.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('pointerdown', presionar, true);
    document.addEventListener('keydown', presionar, true);
    document.addEventListener('visibilitychange', () => { document.documentElement.dataset.pageHidden = document.hidden ? 'true' : 'false'; });
    reducir?.addEventListener('change', () => {
      if (reducir.matches) for (const elemento of observados) elemento.dataset.motionState = 'ready';
    });
  };
  if (document.body) instalar(); else document.addEventListener('DOMContentLoaded', instalar, { once: true });
})(window);
