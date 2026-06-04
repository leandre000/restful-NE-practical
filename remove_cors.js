const fs = require('fs');
const path = require('path');

const servicesDir = 'c:/Users/Shema/Downloads/FEMS-ext/FEMS/services';
const services = fs.readdirSync(servicesDir);

services.forEach(service => {
  const indexJsPath = path.join(servicesDir, service, 'src', 'index.js');
  if (fs.existsSync(indexJsPath)) {
    let content = fs.readFileSync(indexJsPath, 'utf8');
    // Remove the cors middleware line
    content = content.replace(/app\.use\(cors\(\{.*?\}\)\);/g, '// CORS removed (handled by gateway)');
    content = content.replace(/const cors = require\('cors'\);/g, '// cors required removed');
    fs.writeFileSync(indexJsPath, content);
    console.log('Removed CORS from ' + service);
  }
});
