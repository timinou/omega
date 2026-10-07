const task = process.argv[2];
try {
  const r = await fetch('http://127.0.0.1:8797/browser/research', {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({task})
  });
  const result = await r.json();
  if (!r.ok || !result.ok) throw new Error(result.message);
  console.log(result.result);
} catch (error) { console.error(error.message); process.exitCode = 1; }
