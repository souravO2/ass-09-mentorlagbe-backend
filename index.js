import express from "express";
import cors from "cors";
import "dotenv/config";
import { MongoClient } from "mongodb";
import { ObjectId } from "mongodb";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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
const payments = db.collection("payments");

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).send({ message: "Unauthorized" });
  }
  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).send({ message: "Unauthorized" });
  }
  const query = { token };
  const session = await sessions.findOne(query);
  if (!session) {
    return res.status(401).send({ message: "Unauthorized" });
  }
  const userId = session.userId;
  const user = await users.findOne({ _id: new ObjectId(userId) });
  if (!user) {
    return res.status(401).send({ message: "Unauthorized" });
  }
  req.user = user;
  next();
};

const verifyStudent = async (req, res, next) => {
  if (req.user.role !== "student") {
    return res.status(403).send({ message: "Forbidden" });
  }
  next();
};

const verifyTutor = async (req, res, next) => {
  if (req.user.role !== "tutor") {
    return res.status(403).send({ message: "Forbidden" });
  }
  next();
};

const verifyAdmin = async (req, res, next) => {
  if (req.user.role !== "admin") {
    return res.status(403).send({ message: "Forbidden" });
  }
  next();
};

app.get("/", (req, res) => {
  res.send("Hello from MentorLagbe server!");
});

//tuitions routes
app.post("/tuitions", verifyToken, verifyTutor, async (req, res) => {
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

app.get("/tuitions/fresh", async (req, res) => {
  try {
    const freshTuitions = await tuitions
      .find({ approvalStatus: "approved", isActive: true })
      .sort({ createdAt: -1 })
      .limit(6)
      .toArray();

    res.send(freshTuitions);
  } catch (error) {
    console.error(error);
    res.status(500).send({
      message: "Failed to load fresh tuitions",
    });
  }
});

app.get("/top-subjects", async (req, res) => {
  try {
    const topSubjects = await tuitions
      .aggregate([
        {
          $match: {
            approvalStatus: "approved",
            isActive: true,
          },
        },
        {
          $group: {
            _id: "$subject",
            tuitionCount: { $sum: 1 },
            createdAt: { $max: "$createdAt" },
          },
        },
        {
          $sort: {
            tuitionCount: -1,
            createdAt: -1, // Sort by createdAt in descending order for tie-breaking
          },
        },
        { $limit: 4 },
        {
          $project: {
            _id: 0,
            subject: "$_id",
            tuitionCount: 1,
          },
        },
      ])
      .toArray();

    res.send(topSubjects);
  } catch (error) {
    console.error("Failed to fetch top subjects:", error);
    res.status(500).send({
      message: "Failed to fetch top subjects",
    });
  }
});

app.get("/tuitions/all", verifyToken, verifyAdmin, async (req, res) => {
  try {
    // Fetch all tuitions for admin view

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

app.patch("/tuitions/:id", verifyToken, async (req, res) => {
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

app.delete("/tuitions/:id", verifyToken, verifyTutor, async (req, res) => {
  const id = req.params.id;
  const filter = { _id: new ObjectId(id) };
  const result = await tuitions.deleteOne(filter);
  res.send(result);
});

app.get("/tuitions/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  const tuition = await tuitions.findOne({ _id: new ObjectId(id) });
  if (!tuition) {
    return res.status(404).send({ message: "Tuition not found" });
  }
  res.send(tuition);
});

// application routes
app.post("/applications", verifyToken, verifyStudent, async (req, res) => {
  const data = await req.body;
  const application = {
    ...data,
    appliedAt: new Date(),
  };
  const result = await applications.insertOne(application);
  res.send(result);
});

app.get("/applications", verifyToken, async (req, res) => {
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
    const { studentId, tuitionId } = req.query;
    const [found, count] = await Promise.all([
      // Check if already applied to this tuition
      applications.findOne({
        studentId,
        tuitionId,
      }),

      // Count all applications by this student
      applications.countDocuments({
        studentId,
      }),
    ]);

    return res.send({
      applied: Boolean(found),
      count,
    });
  }
  const cursor = applications.find(query).sort({ appliedAt: -1 });
  const result = await cursor.toArray();
  res.send(result);
});

app.delete(
  "/applications/:id",
  verifyToken,
  verifyStudent,
  async (req, res) => {
    const id = req.params.id;
    const filter = { _id: new ObjectId(id) };
    const result = await applications.deleteOne(filter);
    res.send(result);
  },
);

app.patch("/applications/:id", verifyToken, async (req, res) => {
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
app.get("/admin/stats", verifyToken, verifyAdmin, async (req, res) => {
  try {
    // TODO: Verify the logged-in user is an admin

    const [
      totalUsers,
      totalTutors,
      pendingTuitions,
      approvedTuitions,
      revenueResult,
    ] = await Promise.all([
      users.countDocuments(),

      users.countDocuments({
        role: "tutor",
      }),

      tuitions.countDocuments({
        approvalStatus: "pending",
      }),

      tuitions.countDocuments({
        approvalStatus: "approved",
      }),

      payments
        .aggregate([
          {
            $match: {
              payment_status: "paid",
            },
          },
          {
            $group: {
              _id: null,
              total: { $sum: "$amount" },
            },
          },
        ])
        .toArray(),
    ]);

    const data = {
      users: totalUsers,
      tutors: totalTutors,
      pending: pendingTuitions,
      approved: approvedTuitions,
      revenue: revenueResult[0]?.total ?? 0,
    };

    res.send(data);
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Failed to load admin statistics",
    });
  }
});

app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const result = await users.find({}).sort({ createdAt: -1 }).toArray();

    const allUsers = result.map((user) => ({
      ...user,
      _id: user._id.toString(),
      createdAt: user.createdAt?.toISOString() ?? null,
    }));

    res.send(allUsers);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to fetch users" });
  }
});

app.patch("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { role } = req.body;
    const { id } = req.params;

    if (!["student", "tutor", "admin"].includes(role)) {
      return res.status(400).send({ message: "Invalid role" });
    }

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid user ID" });
    }

    const result = await users.updateOne(
      { _id: new ObjectId(id) },
      { $set: { role } },
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({ message: "User not found" });
    }

    res.send({ message: "Role updated successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to update role" });
  }
});

// payment routes
app.post("/payments/checkout-verify", verifyToken, async (req, res) => {
  const { sessionId } = req.body;
  const { status, payment_status, customer_email, metadata, payment_intent } =
    await stripe.checkout.sessions.retrieve(sessionId);

  // check is new payment or not
  // check if the sessionId for the currently logged in user
  //insert sessionId into payments collection
  // update user info as premium user
  if (status === "complete" && payment_status === "paid") {
    const sessionQuery = { sessionId };
    const existingPayment = await payments.findOne(sessionQuery);
    if (existingPayment) {
      return res.send({ success: false, message: "Payment already verified" });
    }

    const payment = {
      sessionId,
      status,
      payment_status,
      customer_email,
      customer_name: metadata.customerName,
      customer_role: metadata.role,
      planName: metadata.planName,
      amount: Number(metadata.amount),
      currency: metadata.currency,
      userId: metadata.userId,
      payment_intent,
      paymentDate: new Date(),
    };
    const result = await payments.insertOne(payment);

    // update the user table
    const query = { _id: new ObjectId(metadata.userId) };

    const updatedDoc = {
      $set: {
        plan: "pro",
      },
    };
    const updateResult = await users.updateOne(query, updatedDoc);
    res.send({ success: true, result, updateResult });
    return;
  }
  res.send({ success: false, message: "Payment not verified" });
});

app.get("/payments", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const result = await payments
      .find({ payment_status: "paid" })
      .sort({ paymentDate: -1 })
      .toArray();
    res.send(result);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to load transactions" });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

export default app;
