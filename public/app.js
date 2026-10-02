(() => {
  const canvas = document.querySelector('.ambient-canvas');
  if (canvas) {
    const context = canvas.getContext('2d');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 0; let height = 0; let particles = [];
    const resize = () => { width = canvas.width = window.innerWidth * devicePixelRatio; height = canvas.height = window.innerHeight * devicePixelRatio; context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); particles = Array.from({ length: Math.min(42, Math.max(20, window.innerWidth / 32)) }, () => ({ x: Math.random() * window.innerWidth, y: Math.random() * window.innerHeight, size: Math.random() * 2 + 1, speed: Math.random() * .22 + .06, phase: Math.random() * Math.PI * 2 })); };
    const draw = (time = 0) => { context.clearRect(0, 0, width, height); particles.forEach((particle) => { particle.y -= reduceMotion ? 0 : particle.speed; if (particle.y < -10) particle.y = window.innerHeight + 10; const alpha = .12 + Math.sin(time / 1300 + particle.phase) * .08; context.beginPath(); context.fillStyle = `rgba(84, 214, 178, ${alpha})`; context.arc(particle.x + Math.sin(time / 1900 + particle.phase) * 9, particle.y, particle.size, 0, Math.PI * 2); context.fill(); }); if (!reduceMotion) requestAnimationFrame(draw); };
    resize(); draw(); window.addEventListener('resize', resize, { passive: true });
  }
  document.querySelectorAll('.reveal').forEach((element, index) => { element.style.setProperty('--reveal-delay', `${index * 90}ms`); });
  const clock = document.querySelector('[data-clock]');
  if (clock) { const update = () => { clock.textContent = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' }).format(new Date()); }; update(); setInterval(update, 30000); }
})();