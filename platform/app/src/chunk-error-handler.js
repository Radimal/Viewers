window.addEventListener('error', event => {
  const chunkFailedMessage = /Loading chunk [\d]+ failed/;

  if (event.message && chunkFailedMessage.test(event.message)) {
    console.log('Chunk loading failed, reloading page...');
    window.location.reload();
  }
});

window.addEventListener('unhandledrejection', event => {
  const chunkFailedMessage = /Loading chunk [\d]+ failed/;

  if (event.reason && event.reason.message && chunkFailedMessage.test(event.reason.message)) {
    console.log('Chunk loading failed (unhandled rejection), reloading page...');
    window.location.reload();
  }
});
