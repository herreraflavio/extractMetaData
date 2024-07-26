const fs = require("fs");
const { exec } = require("child_process");

// Path to your JSON file
const jsonFilePath = "./addresses.json"; // Adjust the path as needed

// Function to open a URL in Chrome
function openInChrome(url) {
  exec(`start chrome "${url}"`, (error) => {
    if (error) {
      console.error(`Error opening URL ${url}: ${error.message}`);
    }
  });
}

// Read and parse the JSON file
fs.readFile(jsonFilePath, "utf8", (err, data) => {
  if (err) {
    console.error(`Error reading file ${jsonFilePath}: ${err.message}`);
    return;
  }

  try {
    const locations = JSON.parse(data);
    locations.forEach((location) => {
      if (location.GoogleMapsLink) {
        openInChrome(location.GoogleMapsLink);
      }
    });
  } catch (err) {
    console.error(`Error parsing JSON data: ${err.message}`);
  }
});
