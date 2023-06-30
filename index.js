const express = require('express');
const axios = require('axios');

const app = express();

app.use(express.json()); // Middleware to parse JSON bodies

app.get('/', (request, response) => {
  response.send('Hello, world!');
});

app.post('/', async (request, response) => {
  // Access the JSON body of the request
  
	

	

  // Send the response as JSON
  response.json();
});


app.listen(3000, () => {
  console.log(`Server is listening on port 3000`);
});
