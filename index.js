require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const port = process.env.PORT || 5000;

// middlewares
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://hostelmate-b7e8e.web.app",
      "https://hostelmate-b7e8e.firebaseapp.com",
    ],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).send("Unauthorized access");
  }

  jwt.verify(token, process.env.SECRET_KEY, (err, decoded) => {
    if (err) {
      return res.status(401).send("Unauthorized access");
    }
    next();
  });
};

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.db_user}:${process.env.user_pass}@cluster0.dbupn.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    app.post("/jwt", (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.SECRET_KEY, {
        expiresIn: "1d",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send("Cookie is set");
    });

    app.post("/logout", (req, res) => {
      res
        .clearCookie("token", {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send("Cookie is cleared");
    });

    const mealCollection = client.db("HostelMateDB").collection("meals");
    const reviewCollection = client.db("HostelMateDB").collection("reviews");

    //* meals api

    // create
    app.post("/meals", async (req, res) => {
      const newMeal = req.body;
      const result = await mealCollection.insertOne(newMeal);
      res.send(result);
    });

    // get all or get limited meals
    app.get("/meals", async (req, res) => {
      if (req.query.page) {
        const page = req.query.page;
        const limit = parseInt(req.query.limit);
        const skip = (parseInt(page) - 1) * limit;
        const meals = await mealCollection
          .find()
          .skip(skip)
          .limit(limit)
          .toArray();
        const totalMeals = await mealCollection.countDocuments();
        hasMore = skip + meals.length < totalMeals;
        res.send({ meals, hasMore });
        return;
      }
      const result = await mealCollection.find().toArray();
      res.send(result);
    });

    // get one
    app.get("/meals/:id", async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await mealCollection.findOne(query);
      res.send(result);
    });

    // delete
    app.delete("/meals/:id", async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await mealCollection.deleteOne(query);
      res.send(result);
    });

    // update
    app.put("/meals/:id", async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          ...req.body,
        },
      };
      const result = await mealCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    //* reviews api

    // create
    app.post("/reviews", async (req, res) => {
      const newReview = req.body;
      const mealId = req.body.mealId;
      const reviewInsert = await reviewCollection.insertOne(newReview);
      const reviewCount = await mealCollection.updateOne(
        { _id: new ObjectId(mealId) },
        { $inc: { review_count: 1 } }
      );
      const result = {reviewInsert, reviewCount}
      res.send(result);
    });

    // get reviews for one meal
    app.get("/reviews/:id", async (req, res) => {
      const { id } = req.params;
      const query = { mealId: id };
      const result = await reviewCollection.find(query).toArray();
      res.send(result);
    });

    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Loading delicious meals");
});

app.listen(port, () => {
  console.log(`Meals coming in ${port}`);
});
