const fs = require('fs');
const yaml = require('yamljs');
const path = '../swagger.yaml';
let doc;
try {
  doc = yaml.load(path);
} catch(e) {
  console.log(e);
  process.exit(1);
}

// Add parameters to all GET requests
for (const url in doc.paths) {
  const methods = doc.paths[url];
  if (methods.get) {
    methods.get.parameters = [
      { in: 'query', name: 'page', schema: { type: 'integer', default: 1 }, description: 'Page number' },
      { in: 'query', name: 'limit', schema: { type: 'integer', default: 10 }, description: 'Number of items' }
    ];
    if (url.includes('extinguisher') || url.includes('users')) {
       methods.get.parameters.push({ in: 'query', name: 'search', schema: { type: 'string' }, description: 'Search term' });
    }
  }
}

// Add bodies to POST
if (doc.paths['/auth/login'] && doc.paths['/auth/login'].post) {
  doc.paths['/auth/login'].post.requestBody = {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            email: { type: 'string', example: 'admin@femcs.rw' },
            password: { type: 'string', example: 'Admin@1234' }
          }
        }
      }
    }
  };
}

if (doc.paths['/extinguishers'] && doc.paths['/extinguishers'].post) {
  doc.paths['/extinguishers'].post.requestBody = {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            serialNumber: { type: 'string', example: 'EXT-999' },
            type: { type: 'string', example: 'CO2' },
            weight: { type: 'string', example: '5kg' },
            locationId: { type: 'integer', example: 1 },
            manufactureDate: { type: 'string', example: '2023-01-01' },
            expiryDate: { type: 'string', example: '2028-01-01' }
          }
        }
      }
    }
  };
}

// Write back to file
const newYaml = yaml.stringify(doc, 6, 2);
fs.writeFileSync(path, newYaml);
console.log('Swagger updated successfully!');
