import https from 'https';

const options = {
  hostname: 'api.github.com',
  path: '/repos/KouSug/task-management/actions/runs/27338504100/jobs',
  headers: { 'User-Agent': 'Node.js' }
};

https.get(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const jobs = JSON.parse(data).jobs;
    const buildJob = jobs.find(j => j.name === 'build');
    if(buildJob) {
      https.get({ hostname: 'api.github.com', path: `/repos/KouSug/task-management/actions/jobs/${buildJob.id}/logs`, headers: { 'User-Agent': 'Node.js' } }, (res2) => {
        // If it's a 302 redirect, follow it
        if(res2.statusCode === 302) {
          https.get(res2.headers.location, (res3) => {
            let data3 = '';
            res3.on('data', chunk => data3 += chunk);
            res3.on('end', () => console.log(data3.substring(data3.length - 1000)));
          });
        }
      });
    }
  });
});
