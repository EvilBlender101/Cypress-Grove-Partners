// Get started form: checks the required fields, then sends the form to /api/intake.
(function () {
  var form = document.getElementById('intake-form');
  var done = document.getElementById('intake-done');
  var status = document.getElementById('form-status');
  if (!form || !done || !status) return;
  var submit = form.querySelector('.intake-submit');
  var submitLabel = submit.innerHTML;
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  var checks = [
    { id: 'f-name', ok: function (v) { return v.length > 0; } },
    { id: 'f-email', ok: function (v) { return EMAIL.test(v); } },
    { id: 'f-company', ok: function (v) { return v.length > 0; } },
    { id: 'f-makes', ok: function (v) { return v.length > 0; } },
    { id: 'f-county', ok: function (v) { return v.length > 0; } }
  ];

  function setError(input, show) {
    var error = document.getElementById(input.id + '-error');
    input.setAttribute('aria-invalid', show ? 'true' : 'false');
    if (error) {
      error.hidden = !show;
      if (show) input.setAttribute('aria-describedby', error.id);
      else input.removeAttribute('aria-describedby');
    }
  }

  function validate() {
    var first = null;
    checks.forEach(function (c) {
      var input = document.getElementById(c.id);
      var good = c.ok(input.value.trim());
      setError(input, !good);
      if (!good && !first) first = input;
    });
    return first;
  }

  // Clear a field's error as soon as it's fixed
  checks.forEach(function (c) {
    var input = document.getElementById(c.id);
    var evt = input.tagName === 'SELECT' ? 'change' : 'input';
    input.addEventListener(evt, function () {
      if (input.getAttribute('aria-invalid') === 'true' && c.ok(input.value.trim())) setError(input, false);
    });
  });

  function showStatus(message) {
    status.textContent = message;
    status.hidden = false;
  }

  function setBusy(busy) {
    submit.disabled = busy;
    submit.innerHTML = busy ? 'Sending…' : submitLabel;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    status.hidden = true;
    var firstBad = validate();
    if (firstBad) { firstBad.focus(); return; }

    var data = {};
    new FormData(form).forEach(function (value, key) { data[key] = typeof value === 'string' ? value.trim() : ''; });
    if (!data['cf-turnstile-response']) {
      showStatus('The spam check hasn’t finished yet. Wait a moment, then send again.');
      return;
    }

    setBusy(true);
    fetch('/api/intake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) { return { ok: res.ok, body: body }; });
    }).then(function (r) {
      if (r.ok && r.body.ok) {
        form.hidden = true;
        done.hidden = false;
        done.focus();
        return;
      }
      setBusy(false);
      if (window.turnstile) window.turnstile.reset();
      showStatus(r.body.error || 'Your details didn’t send. Try again, or email info@cypressgrove.partners.');
    }).catch(function () {
      setBusy(false);
      if (window.turnstile) window.turnstile.reset();
      showStatus('Your details didn’t send because the connection dropped. Try again, or email info@cypressgrove.partners.');
    });
  });
})();
