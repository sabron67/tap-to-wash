(function () {
  'use strict';
  var date = document.getElementById('pickupDate');
  var slot = document.getElementById('pickupSlot');
  var note = document.getElementById('pickupAvailability');
  if (!date || !slot) return;
  var today = new Date();
  var localToday = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  var max = new Date(today.getTime() + 14 * 86400000);
  var localMax = new Date(max.getTime() - max.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  date.min = localToday; date.max = localMax; date.value = localToday;
  async function load() {
    slot.disabled = true;
    slot.innerHTML = '<option value="">Checking availability…</option>';
    note.textContent = 'Checking available riders and pickup times…';
    try {
      var r = await fetch('/api/pickup-slots?date=' + encodeURIComponent(date.value), { credentials: 'same-origin' });
      var d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || 'Could not check availability.');
      slot.innerHTML = '<option value="">Choose a time slot</option>';
      var available = 0;
      d.slots.forEach(function (s) {
        var o = document.createElement('option');
        o.value = s.value; o.textContent = s.label + (s.available ? ' · ' + s.remaining + ' rider slot(s) left' : ' · Fully booked');
        o.disabled = !s.available;
        if (s.available) available++;
        slot.appendChild(o);
      });
      slot.disabled = available === 0;
      note.textContent = available ? available + ' time slots currently have rider capacity. Availability is checked again when you book.' : 'No pickup slots are available for this date. Please choose another date.';
    } catch (e) {
      slot.innerHTML = '<option value="">Availability unavailable</option>';
      note.textContent = e.message || 'Could not load pickup availability.';
    }
  }
  date.addEventListener('change', load);
  load();
})();
