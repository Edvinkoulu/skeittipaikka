const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const fetch = require('node-fetch');
const multer = require('multer');
const path = require('path');

dotenv.config();

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());

// Palvellaan uploads-kansiota staattisesti
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// MongoDB-yhteys
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('MongoDB yhdistetty'))
.catch(err => console.error('MongoDB-yhteysvirhe:', err));

// Skeema
const spotSchema = new mongoose.Schema({
  name: String,
  city: String,
  description: String,
  category: Number,
  ratingFlat: Number,
  ratingCrowd: Number,
  coords: {
    lat: Number,
    lng: Number
  },
  imageUrl: { 
    type: [String],   // tallennetaan tiedostonimet
    default: ["/images/default-spot.svg"] 
  } 
});

const Spot = mongoose.model('Spot', spotSchema);

// Multer tallentaa levylle uploads-kansioon
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const uploadDisk = multer({ storage });

// Testi
app.get('/api/test', (req, res) => res.json({ message: 'Serveri toimii!' }));

// Hae kaikki spotit
app.get('/api/spots', async (req, res) => {
  try {
    const q = req.query.q || '';
    const regex = new RegExp(q, 'i');
    const spots = await Spot.find({
      $or: [
        { name: regex },
        { city: regex },
        { description: regex }
      ]
    });
    res.json(spots);
  } catch (error) {
    res.status(500).json({ error: 'Tietojen haku epäonnistui.' });
  }
});

// Hae tietty spotti
app.get('/api/spots/:id', async (req, res) => {
  try {
    const spot = await Spot.findById(req.params.id);
    if (!spot) return res.status(404).json({ message: 'Spot not found' });
    res.json(spot);
  } catch (err) {
    res.status(500).json({ message: 'Virhe spotin haussa' });
  }
});

// Reverse geocode
app.get('/api/reverse', async (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) return res.status(400).json({ error: "Lat ja lon vaaditaan" });

  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=fi`,
      { headers: { "User-Agent": "skatespots-app/1.0" } }
    );
    const data = await response.json();
    const city = data.address?.city || data.address?.town || data.address?.village || "Tuntematon";
    res.json({ city });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Kaupunkia ei voitu hakea' });
  }
});

// Lisää spotti ja kuva
app.post('/api/spots', uploadDisk.array('images'), async (req, res) => {
  try {
    const { name, city, coords, description, ratingFlat, ratingCrowd, category } = req.body;

    let parsedCoords = coords;
    if (typeof coords === 'string') {
      try { parsedCoords = JSON.parse(coords); } catch { parsedCoords = {}; }
    }

    let images = [];
    if (req.files && req.files.length > 0) {
      images = req.files.map(file => `/uploads/${file.filename}`);
    }

    const newSpot = new Spot({ 
      name, 
      city, 
      coords: parsedCoords,
      description, 
      ratingFlat, 
      ratingCrowd, 
      category, 
      imageUrl: images.length > 0 ? images : undefined
    });

    const savedSpot = await newSpot.save();
    res.status(201).json(savedSpot);
  } catch (error) {
    console.error('Skeittipaikan lisäys epäonnistui:', error);
    res.status(500).json({ error: 'Skeittipaikan tallennus epäonnistui.' });
  }
});

// Hae spotin kuva
app.get('/api/spots/:id/image/:index', async (req, res) => {
  const { id, index } = req.params;
  const spot = await Spot.findById(id);
  if (!spot || !Array.isArray(spot.imageUrl) || !spot.imageUrl[index]) {
    return res.status(404).send('Kuvaa ei löytynyt');
  }

  const imagePath = path.join(__dirname, spot.imageUrl[index].replace('/uploads/', 'uploads/'));
  res.sendFile(imagePath);
});

// Lisää kuvan olemassa olevaan spottiin ja poistaa mahdollisen defaultin
app.post('/api/spots/:id/add-image', uploadDisk.single('image'), async (req, res) => {
  try {
    const spot = await Spot.findById(req.params.id);
    if (!spot) return res.status(404).json({ message: 'Spot ei löytynyt' });

    spot.imageUrl = spot.imageUrl.filter(url => !url.includes('default-spot.svg'));

    if (req.file) {
      spot.imageUrl.push(`/uploads/${req.file.filename}`);
      await spot.save();
    }

    res.json(spot);
  } catch (err) {
    console.error('Kuvan lisäys epäonnistui:', err);
    res.status(500).json({ message: 'Kuvan tallennus epäonnistui' });
  }
});

const PORT = process.env.PORT || 5050;
app.listen(PORT, () => console.log(`Serveri käynnissä: http://localhost:${PORT}`));