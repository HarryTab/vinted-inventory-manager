(function () {
  function runner(successHandler, failureHandler) {
    return new Proxy(
      {
        withSuccessHandler(handler) {
          return runner(handler, failureHandler);
        },
        withFailureHandler(handler) {
          return runner(successHandler, handler);
        }
      },
      {
        get(target, prop) {
          if (prop in target) return target[prop];
          return async (...args) => {
            try {
              if (window.vintedApi && typeof window.vintedApi[prop] === 'function') {
                const result = await window.vintedApi[prop](...args);
                if (successHandler) successHandler(result);
                return;
              }

              const response = await fetch(`/api/rpc/${String(prop)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ args })
              });
              const body = await response.json();
              if (!response.ok || body.error) {
                throw new Error(body.error || `Request failed: ${response.status}`);
              }
              if (successHandler) successHandler(body.result);
            } catch (error) {
              if (failureHandler) failureHandler(error);
              else throw error;
            }
          };
        }
      }
    );
  }

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  window.google.script.run = runner();
})();
