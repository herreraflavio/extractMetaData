const { exec } = require("child_process");
const axios = require("axios");
const fs = require("fs");
const fsp = fs.promises;

const path = require("path");
const puppeteer = require("puppeteer");

const sampleListPath = "sampleSubDomainsList.json";
const sampleList = JSON.parse(fs.readFileSync(sampleListPath).toString());

async function getSubdomainsWithDomain(url) {
  const urlParts = url.split("/");
  return urlParts[0];
}

async function fetchHtml(url) {
  try {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle0" });
    const html = await page.content();
    await browser.close();

    // Save the HTML to a text file
    // const filePath = path.join(__dirname, "text.txt");
    // await fsp.writeFile(filePath, html);
    //console.log(`HTML saved to ${filePath}`);

    // console.log(html);

    return html;
  } catch (error) {
    console.error("Error fetching HTML:", error);
    return null;
  }
}

async function getHtml(subDomain) {
  let html = await fetchHtml("https://" + subDomain);
  if (html == null) {
    html = await fetchHtml("http://" + subDomain);
  }
  return html;
}

// Function to extract text inside double quotes
async function extractTextInQuotes(text) {
  const regex = /"([^"]*)"/g;
  const matches = [];
  let match;

  while ((match = regex.exec(text)) !== null) {
    matches.push(match[1]);
  }

  return matches;
}

// Function to filter URLs and image paths
async function filterUrlsAndImages(data) {
  return data.filter((item) => {
    // Check if item is a URL with http or https
    if (item.startsWith("http://") || item.startsWith("https://")) {
      return true;
    }

    // Check if item is a local path with specific image extensions or starts with /
    const imageExtensions = [".html", ".png", ".jpeg", ".jpg"];
    if (
      item.startsWith("/") ||
      imageExtensions.some((ext) => item.endsWith(ext))
    ) {
      return true;
    }

    return false;
  });
}

// Helper function to check if a URL is for an image
function isImageUrl(url) {
  return /\.(png|jpg|jpeg)$/i.test(url);
}

// Helper function to check if a URL is for a file
function isFileUrl(url) {
  return /\.(csv|pdf|txt|xlm)$/i.test(url);
}

const downloadImage = async (url, outputPath) => {
  try {
    const response = await axios({
      url,
      method: "GET",
      responseType: "stream",
    });
    const writer = fs.createWriteStream(outputPath);
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });
  } catch (error) {
    console.error(`Failed to download image from ${url}:`, error);
  }
  //console.log("Downloading image from", url);
};

// Function to get image metadata using ExifTool
function getImageMetadata(imagePath, subdomainsWithDomain) {
  return new Promise((resolve, reject) => {
    exec(
      `exiftool -gpslatitude -gpslongitude -gpslatituderef -gpslongituderef "${imagePath}"`,
      (error, stdout, stderr) => {
        if (error) {
          console.error(
            `Error executing exiftool for ${imagePath}: ${error.message}`
          );
          return reject(error);
        }
        if (stderr) {
          console.error(`stderr for ${imagePath}: ${stderr}`);
          return reject(new Error(stderr));
        }

        // Print the raw output for debugging
        //console.log(`ExifTool output for ${imagePath}:`, stdout);

        // Parse the output
        const metadata = parseExifToolOutput(stdout, subdomainsWithDomain);
        resolve(metadata);
      }
    );
  });
}

// Function to parse ExifTool output
function parseExifToolOutput(output, subdomainsWithDomain) {
  const gpsInfo = {};

  // Extract GPS Latitude and Longitude
  const latMatch = output.match(/GPS Latitude\s+:\s+([^\r\n]+)/);
  const lonMatch = output.match(/GPS Longitude\s+:\s+([^\r\n]+)/);
  const latRefMatch = output.match(/GPS Latitude Ref\s+:\s+([^\r\n]+)/);
  const lonRefMatch = output.match(/GPS Longitude Ref\s+:\s+([^\r\n]+)/);

  if (latMatch && lonMatch && latRefMatch && lonRefMatch) {
    gpsInfo.GPSLatitude = latMatch[1].trim();
    gpsInfo.GPSLongitude = lonMatch[1].trim();
    gpsInfo.GPSLatitudeRef = latRefMatch[1].trim();
    gpsInfo.GPSLongitudeRef = lonRefMatch[1].trim();

    // Function to convert DMS to decimal degrees
    const dmsToDecimal = (dms, ref) => {
      // Match degrees, minutes, and seconds
      const regex = /(\d+)\s*deg\s*(\d+)'?\s*(\d+\.?\d*)"?\s*([NSEW])/;
      const match = dms.match(regex);

      if (!match) return NaN; // Invalid format

      const [_, degrees, minutes, seconds, direction] = match;
      let decimal =
        parseFloat(degrees) +
        parseFloat(minutes) / 60 +
        parseFloat(seconds) / 3600;

      if (direction === "S" || direction === "W") decimal = -decimal;

      return decimal;
    };

    // Convert to decimal degrees
    const latDecimal = dmsToDecimal(
      gpsInfo.GPSLatitude,
      gpsInfo.GPSLatitudeRef
    );
    const lonDecimal = dmsToDecimal(
      gpsInfo.GPSLongitude,
      gpsInfo.GPSLongitudeRef
    );

    gpsInfo.Latitude = isNaN(latDecimal) ? "Conversion failed" : latDecimal;
    gpsInfo.Longitude = isNaN(lonDecimal) ? "Conversion failed" : lonDecimal;

    // Format coordinates for Google Maps
    gpsInfo.GoogleMapsLink =
      gpsInfo.Latitude !== "Conversion failed" &&
      gpsInfo.Longitude !== "Conversion failed"
        ? `https://www.google.com/maps?q=${gpsInfo.Latitude},${gpsInfo.Longitude}`
        : "No valid coordinates available";

    gpsInfo.subDomain = `${subdomainsWithDomain}`;
  } else {
    gpsInfo.GPSLatitude = null;
    gpsInfo.GPSLongitude = null;
    gpsInfo.GoogleMapsLink = "No metadata found";
  }

  return gpsInfo;
}

// Function to process all images in a directory
async function processImages(directory, subdomainsWithDomain) {
  const foundImages = [];
  try {
    const files = fs.readdirSync(directory);
    for (const file of files) {
      const imagePath = path.join(directory, file);
      try {
        if (fs.statSync(imagePath).isFile()) {
          const metadata = await getImageMetadata(
            imagePath,
            subdomainsWithDomain
          );
          if (Object.keys(metadata).length > 0) {
            //      console.log(`Metadata for ${file}:`, metadata);
            if (metadata.GoogleMapsLink !== "No metadata found") {
              foundImages.push(metadata);
            }
          } else {
            //    console.log(`No metadata found for ${file}`);
          }
        }
      } catch (fileError) {
        console.error(`Failed to process file ${file}: ${fileError.message}`);
      }
    }
  } catch (error) {
    console.error("Error reading directory or processing images:", error);
  }
  return foundImages;
}

(async () => {
  let i = 0;

  for (const subDomain of sampleList) {
    const outputDir = "output";
    const localImageDir = "./localImage/localImage" + i;

    const localUrls = [];
    const externalUrls = [];
    const externalImages = [];
    const localImages = [];
    const files = [];
    //console.log(subDomain);
    const subdomainsWithDomain = await getSubdomainsWithDomain(subDomain);

    let html = await getHtml(subDomain);

    if (html != null) {
      // Extract text inside quotes
      const extractedTexts = await extractTextInQuotes(html);
      // Filter the data
      const filteredData = await filterUrlsAndImages(extractedTexts);
      // Write filtered data to a new JSON file

      for (let url of filteredData) {
        if (url.endsWith(".js") || url.endsWith(".css")) {
          // Skip JavaScript and CSS files
          continue;
        }

        if (url.startsWith("http://") || url.startsWith("https://")) {
          if (isImageUrl(url)) {
            externalImages.push(url);
          } else if (url.endsWith(".html") || url.endsWith(".htm")) {
            externalUrls.push(url);
          } else {
            // Other external URLs
            externalUrls.push(url);
          }
        } else if (url.startsWith("/")) {
          //  console.log(url);
          if (isImageUrl(url)) {
            if (url.startsWith("/")) {
              url = subdomainsWithDomain + url;
            } else {
              url = subdomainsWithDomain + "/" + url;
            }
            localImages.push(url);
          } else if (isFileUrl(url)) {
            files.push(url);
          } else {
            if (url.startsWith("/")) {
              url = subdomainsWithDomain + url;
            } else {
              url = subdomainsWithDomain + "/" + url;
            }
            // Handle local URLs, which could be HTML files
            localUrls.push(url);
          }
        } else if (url.endsWith(".html") || url.endsWith(".htm")) {
          if (url.startsWith("/")) {
            url = `https://${subdomainsWithDomain}/people.html` + url;

            nonSecureUrls.push(url);
          } else {
            url = `https://${subdomainsWithDomain}/people.html/` + url;
          }
          localUrls.push(url); // Handle cases where URL s don't start with http, https, or /
        } else if (
          url.endsWith(".png") ||
          url.endsWith(".jpg") ||
          url.endsWith(".jpeg")
        ) {
          if (url.startsWith("/")) {
            url = `https://${subdomainsWithDomain}` + url;

            nonSecureUrls.push(url);
          } else {
            url = `https://${subdomainsWithDomain}/` + url;
          }
          localImages.push(url); // Handle cases where URL s don't start with http, https, or /
        }
      }

      // Download local images
      if (!fs.existsSync(localImageDir)) {
        fs.mkdirSync(localImageDir);
      }

      //console.log(localImages);

      for (const localImage of localImages) {
        const imageName = path.basename(localImage);
        const outputPath = path.join(localImageDir, imageName);
        await downloadImage(localImage, outputPath);
        //console.log(`Downloaded ${localImage} to ${outputPath}`);
      }

      for (const externalImage of externalImages) {
        const imageName = path.basename(externalImage);
        const outputPath = path.join(localImageDir, imageName);
        await downloadImage(externalImage, outputPath);
        // console.log(`Downloaded ${externalImage} to ${outputPath}`);
      }
      //   // Write output JSON files
      //   if (!fs.existsSync(outputDir)) {
      //     fs.mkdirSync(outputDir);
      //   }

      //   fs.writeFileSync(
      //     path.join(outputDir, "localUrls.json"),
      //     JSON.stringify(localUrls, null, 2)
      //   );
      //   fs.writeFileSync(
      //     path.join(outputDir, "externalUrls.json"),
      //     JSON.stringify(externalUrls, null, 2)
      //   );
      //   fs.writeFileSync(
      //     path.join(outputDir, "externalImages.json"),
      //     JSON.stringify(externalImages, null, 2)
      //   );
      //   fs.writeFileSync(
      //     path.join(outputDir, "localImages.json"),
      //     JSON.stringify(localImages, null, 2)
      //   );
      //   fs.writeFileSync(
      //     path.join(outputDir, "files.json"),
      //     JSON.stringify(files, null, 2)
      //   );

      //   console.log(
      //     'Processing complete. Files have been written to the "output" directory.'
      //   );
      console.log("Images downloaded successfully");

      //   // Path to the output directory

      const outputDir = "./localImage/localImage" + i;
      let metaDataResponse;
      // Check if the directory exists before processing
      // Check if the directory exists before processing
      if (fs.existsSync(outputDir) && fs.statSync(outputDir).isDirectory()) {
        metaDataResponse = await processImages(outputDir, subdomainsWithDomain);
        console.log("meta data response: ", metaDataResponse);

        const jsonFilePath = path.join(__dirname, "addresses.json");
        let existingData = [];

        // Check if the JSON file exists and read the existing data
        if (fs.existsSync(jsonFilePath)) {
          try {
            const fileContent = fs.readFileSync(jsonFilePath, "utf8");
            if (fileContent.trim()) {
              existingData = JSON.parse(fileContent);
            }
          } catch (error) {
            console.error("Error reading or parsing JSON file:", error);
          }
        }

        // Merge the new metaDataResponse with the existing data
        const updatedData = existingData.concat(metaDataResponse);

        // Write the combined data back to the JSON file
        fs.writeFileSync(jsonFilePath, JSON.stringify(updatedData, null, 2));
      } else {
        console.error(
          `Directory ${outputDir} does not exist or is not a directory.`
        );
      }

      i++;
      console.log("Processing complete.");
    } else {
      console.log("No HTML content found");
    }
  }
})();
