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

const PAGE_SIZE = 10; // keep in sync with PAGE_SIZE in lib/tuition-query.ts

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

app.get("/tuitions", async (req, res) => {
  try {
    const { tutorId, search, subject, classLevel, mode } = req.query;

    // Tutor's own tuitions: plain array
    if (typeof tutorId === "string" && tutorId) {
      const own = await tuitions
        .find({ tutorId })
        .sort({ createdAt: -1 })
        .toArray();
      return res.send(own);
    }

    // Public browse: only approved and active tuitions
    const query = { approvalStatus: "approved", isActive: true };

    if (typeof subject === "string" && subject) query.subject = subject;
    if (typeof classLevel === "string" && classLevel)
      query.classLevel = classLevel;
    if (mode === "Online" || mode === "Offline") query.mode = mode;

    const term = typeof search === "string" ? search.trim().slice(0, 100) : "";
    if (term) {
      const pattern = new RegExp(escapeRegex(term), "i");
      query.$or = [{ title: pattern }, { subject: pattern }];
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);

    const [result, total] = await Promise.all([
      tuitions
        .find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .toArray(),
      tuitions.countDocuments(query),
    ]);

    res.send({
      tuitions: result,
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to load tuitions" });
  }
});

app.get("/tuitions/all", async (req, res) => {
  try {
    // TODO: Verify the logged-in user is an admin here.

    const allTuitions = await tuitions
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    res.send(allTuitions);
  } catch (error) {
    console.error(error);
    res.status(500).send({
      message: "Failed to load all tuitions",
    });
  }
});

app.patch("/tuitions/:id", async (req, res) => {
  const id = req.params.id;
  const data = req.body;
  const filter = { _id: new ObjectId(id) };
  const updateDoc = {
    $set: {
      ...data,
    },
  };
  const result = await tuitions.updateOne(filter, updateDoc);
  res.send(result);
});

app.delete("/tuitions/:id", async (req, res) => {
  const id = req.params.id;
  const filter = { _id: new ObjectId(id) };
  const result = await tuitions.deleteOne(filter);
  res.send(result);
});

app.get("/tuitions/:id", async (req, res) => {
  const { id } = req.params;
  const tuition = await tuitions.findOne({ _id: new ObjectId(id) });
  if (!tuition) {
    return res.status(404).send({ message: "Tuition not found" });
  }
  res.send(tuition);
});

// application routes
app.post("/applications", async (req, res) => {
  const data = await req.body;
  const application = {
    ...data,
    appliedAt: new Date(),
  };
  const result = await applications.insertOne(application);
  res.send(result);
});

app.get("/applications", async (req, res) => {
  const query = {};
  if (req.query.tutorId) {
    query.tutorId = req.query.tutorId;
  }
  if (req.query.studentId) {
    query.studentId = req.query.studentId;
  }
  if (req.query.tuitionId) {
    query.tuitionId = req.query.tuitionId;
  }
  if (req.query.studentId && req.query.tuitionId) {
    const found = await applications.findOne(query);

    return res.send({
      applied: Boolean(found),
    });
  }
  const cursor = applications.find(query).sort({ appliedAt: -1 });
  const result = await cursor.toArray();
  res.send(result);
});

app.delete("/applications/:id", async (req, res) => {
  const id = req.params.id;
  const filter = { _id: new ObjectId(id) };
  const result = await applications.deleteOne(filter);
  res.send(result);
});

app.patch("/applications/:id", async (req, res) => {
  const id = req.params.id;
  const data = req.body;
  const filter = { _id: new ObjectId(id) };
  const updateDoc = {
    $set: {
      ...data,
    },
  };
  const result = await applications.updateOne(filter, updateDoc);
  res.send(result);
});

// user routes

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

export default app;
