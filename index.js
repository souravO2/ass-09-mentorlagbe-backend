import express from "express";
import cors from "cors";
import "dotenv/config";
import { MongoClient } from "mongodb";
import { ObjectId } from "mongodb";

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

const client = new MongoClient(process.env.MDB_URI);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const mongoClient = await connectToMongoDB();
const db = mongoClient.db("mentorlagbe");
const users = db.collection("user");
const sessions = db.collection("session");
const tuitions = db.collection("tuitions");
const applications = db.collection("applications");

app.get("/", (req, res) => {
  res.send("Hello from MentorLagbe server!");
});

//tuitions routes
app.post("/tuitions", async (req, res) => {
  const data = await req.body;
  const tuition = {
    ...data,
    monthlyFee: Number(data.monthlyFee),
    daysPerWeek: Number(data.daysPerWeek),
    createdAt: new Date(),
  };
  const result = await tuitions.insertOne(tuition);
  res.send(result);
});

app.get("/tuitions", async (req, res) => {
  const query = {};
  if (req.query) {
    if (req.query.tutorId) {
      query.tutorId = req.query.tutorId;
    }
  }
  const cursor = tuitions.find(query);
  const result = await cursor.toArray();
  res.send(result);
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

export default app;
