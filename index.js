require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
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
    const mealCollection = client.db("HostelMateDB").collection("meals");
    const userCollection = client.db("HostelMateDB").collection("users");
    const reviewCollection = client.db("HostelMateDB").collection("reviews");
    const paymentCollection = client.db("HostelMateDB").collection("payments");
    const upcomingMealCollection = client
      .db("HostelMateDB")
      .collection("upcomingMeals");
    const requestedMealsCollection = client
      .db("HostelMateDB")
      .collection("requestedMeals");

    // jwt
    app.post("/jwt", (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_SECRET_KEY, {
        expiresIn: "1d",
      });
      res.send({ token });
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

    //! middlewares
    const verifyToken = (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).send("Unauthorized access");
      }

      const token = req.headers.authorization.split(" ")[1];

      jwt.verify(token, process.env.ACCESS_SECRET_KEY, (err, decoded) => {
        if (err) {
          return res.status(401).send("Unauthorized access");
        }
        req.decoded = decoded;
        next();
      });
    };

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    //! upcoming meals api

    // create
    app.post("/upcoming-meals", verifyToken, verifyAdmin, async (req, res) => {
      const newMeal = req.body;
      const result = await upcomingMealCollection.insertOne(newMeal);
      res.send(result);
    });

    // get all or get limited upcoming meals
    app.get("/upcoming-meals", async (req, res) => {
      if (req.query.page) {
        const page = req.query.page;
        const limit = parseInt(req.query.limit);
        const skip = (parseInt(page) - 1) * limit;
        const meals = await upcomingMealCollection
          .find()
          .skip(skip)
          .limit(limit)
          .toArray();
        const totalMeals = await upcomingMealCollection.countDocuments();
        hasMore = skip + meals.length < totalMeals;
        res.send({ meals, hasMore });
        return;
      }
      const result = await upcomingMealCollection.find().toArray();
      res.send(result);
    });

    app.get("/upcoming-meals/paginate", async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const meals = await upcomingMealCollection
          .find()
          .sort({ likes: -1 })
          .skip(skip)
          .limit(limit)
          .toArray();
        const totalMeals = await upcomingMealCollection.countDocuments();
        res.status(200).send({
          meals,
          totalMeals,
          currentPage: page,
          totalPages: Math.ceil(totalMeals / limit),
        });
      } catch (error) {
        console.error("Error while paginating meals:", error.message);
        res
          .status(500)
          .send({ message: "An error occurred while fetching meals." });
      }
    });

    app.patch("/upcoming-meals/publish/:id", async (req, res) => {
      const { id } = req.params;
      const meal = await upcomingMealCollection.findOne({
        _id: new ObjectId(id),
      });
      if (!meal) {
        return res.status(404).json({ error: "Meal not found" });
      }
      await mealCollection.insertOne(meal);

      const result = await upcomingMealCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // like button api
    app.patch("/upcoming-likes/:id", verifyToken, async (req, res) => {
      const { id } = req.params;
      const { email } = req.query;
      const result = await upcomingMealCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $inc: { likes: 1 },
          $addToSet: { likedUsers: email },
        },
        { upsert: true }
      );
      res.send(result);
    });

    //! users api

    // create
    app.post("/users", async (req, res) => {
      const user = req.body;
      const isNew = await userCollection.findOne({ email: user.email });
      if (!isNew) {
        const result = await userCollection.insertOne(user);
        res.send(result);
      } else {
        res.send({ message: "User already exists!", insertedId: null });
      }
    });

    // get all
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const meals = await userCollection
          .find()
          .skip(skip)
          .limit(limit)
          .toArray();
        const totalUsers = await userCollection.countDocuments();
        res.send({
          meals: meals,
          currentPage: page,
          totalPages: Math.ceil(totalUsers / limit),
        });
      } catch (error) {
        console.error("Error while fetching reviews:", error.message);
        res
          .status(500)
          .send({ message: "An error occurred while fetching reviews." });
      }
    });

    // make admin
    app.patch("/user/admin", verifyToken, verifyAdmin, async (req, res) => {
      const { email } = req.body;
      const result = await userCollection.updateOne(
        { email: email },
        { $set: { role: "admin" } }
      );
      res.send(result);
    });

    // get one
    app.get("/users/:email", verifyToken, async (req, res) => {
      const { email } = req.params;
      const query = { email: email };
      const result = await userCollection.findOne(query);
      res.send(result);
    });

    // search
    app.post("/search-users", verifyToken, async (req, res) => {
      const { searchValue } = req.body;
      const results = await userCollection
        .find({
          $or: [
            { name: { $regex: searchValue, $options: "i" } },
            { email: { $regex: searchValue, $options: "i" } },
            { role: { $regex: searchValue, $options: "i" } },
            { badge: { $regex: searchValue, $options: "i" } },
          ],
        })
        .toArray();

      res.send({ results });
    });

    // check admin
    app.get("/users/admin/:email", verifyToken, async (req, res) => {
      const email = req.params.email;

      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const query = { email: email };
      const user = await userCollection.findOne(query);
      let admin = false;
      if (user) {
        admin = user?.role === "admin";
      }
      res.send({ admin });
    });

    //! meals api

    // create
    app.post("/meals", verifyToken, verifyAdmin, async (req, res) => {
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

    app.get("/meals/paginate", async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const reviews = await mealCollection
          .find()
          .skip(skip)
          .limit(limit)
          .toArray();

        const totalReviews = await mealCollection.countDocuments();

        const hasMore = skip + reviews.length < totalReviews;
        res.send({
          reviews,
          currentPage: page,
          totalPages: Math.ceil(totalReviews / limit),
        });
      } catch (error) {
        console.error("Error while fetching reviews:", error.message);
        res
          .status(500)
          .send({ message: "An error occurred while fetching reviews." });
      }
    });

    // get one
    app.get("/meals/:id", async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await mealCollection.findOne(query);
      res.send(result);
    });

    // delete
    app.delete("/meals/:id", verifyToken, verifyAdmin, async (req, res) => {
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

    // count the total number of meals
    app.get("/meals-count", async (req, res) => {
      const { email } = req.body;
      const result = await mealCollection.countDocuments({
        "distributor.email": email,
      });
      res.send({ count: result });
    });

    // like button api
    app.put("/likes/:id", verifyToken, async (req, res) => {
      const { id } = req.params;
      const result = await mealCollection.updateOne(
        { _id: new ObjectId(id) },
        { $inc: { likes: 1 } }
      );
      res.send(result);
    });

    // search meals
    app.post("/search-meals", async (req, res) => {
      const { searchValue } = req.body;
      const results = await mealCollection
        .find({
          $or: [
            { title: { $regex: searchValue, $options: "i" } },
            { description: { $regex: searchValue, $options: "i" } },
            { category: { $regex: searchValue, $options: "i" } },
          ],
        })
        .toArray();

      res.send({ results });
    });

    // filter
    app.post("/filter-meals", async (req, res) => {
      const { category, minPrice, maxPrice } = req.body;

      const filter = {};

      if (category) {
        filter.category = category;
      }

      if (minPrice || maxPrice) {
        filter.price = {};
        if (minPrice) filter.price.$gte = parseFloat(minPrice);
        if (maxPrice) filter.price.$lte = parseFloat(maxPrice);
      }

      const meals = await mealCollection.find(filter).toArray();
      res.send(meals);
    });

    // sort meals
    app.post("/meals/sort", async (req, res) => {
      const { sort } = req.body;
      if (sort) {
        const result = await mealCollection
          .find()
          .sort({ likes: -1 })
          .toArray();
        res.send(result);
      } else {
        const result = await mealCollection
          .find()
          .sort({ reviews_count: -1 })
          .toArray();
        res.send(result);
      }
    });

    //! reviews api

    // create
    app.post("/reviews", verifyToken, async (req, res) => {
      const newReview = req.body;
      const mealId = req.body.mealId;
      const reviewInsert = await reviewCollection.insertOne(newReview);
      const reviewCount = await mealCollection.updateOne(
        { _id: new ObjectId(mealId) },
        { $inc: { review_count: 1 } }
      );
      const result = { reviewInsert, reviewCount };
      res.send(result);
    });

    // get all reviews
    app.get("/reviews", verifyToken, verifyAdmin, async (req, res) => {
      const result = await reviewCollection.find().toArray();
      res.send(result);
    });

    app.get("/reviews/paginate", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const reviews = await reviewCollection
          .find()
          .skip(skip)
          .limit(limit)
          .toArray();

        const totalReviews = await reviewCollection.countDocuments();

        res.send({
          reviews,
          currentPage: page,
          totalPages: Math.ceil(totalReviews / limit),
        });
      } catch (error) {
        console.error("Error while fetching reviews:", error.message);
        res
          .status(500)
          .send({ message: "An error occurred while fetching reviews." });
      }
    });

    // get reviews for one meal
    app.get("/reviews/:id", async (req, res) => {
      const { id } = req.params;
      const query = { mealId: id };
      const result = await reviewCollection.find(query).toArray();
      res.send(result);
    });

    // get reviews of one user
    app.get("/student_reviews/:email", verifyToken, async (req, res) => {
      try {
        const { email } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const reviews = await reviewCollection
          .find({ "reviewer.email": email })
          .sort({ likes: -1 })
          .skip(skip)
          .limit(limit)
          .toArray();
        const totalReviews = await reviewCollection.countDocuments({
          "reviewer.email": email,
        });
        res.status(200).send({
          reviews,
          totalReviews,
          currentPage: page,
          totalPages: Math.ceil(totalReviews / limit),
        });
      } catch (error) {
        console.error("Error while paginating meals:", error.message);
        res
          .status(500)
          .send({ message: "An error occurred while fetching meals." });
      }
    });

    app.post("/search-review", verifyToken, async (req, res) => {
      const { searchValue } = req.body;
      const results = await reviewCollection
        .find({
          $or: [
            { "reviewer.name": { $regex: searchValue, $options: "i" } },
            { "reviewer.email": { $regex: searchValue, $options: "i" } },
          ],
        })
        .toArray();

      res.send(results);
    });

    app.delete("/reviews/:id", verifyToken, async (req, res) => {
      const { id } = req.params;
      const { mealId } = req.query;
      const result = await reviewCollection.deleteOne({
        _id: new ObjectId(id),
      });
      const decrease = await mealCollection.updateOne(
        { _id: new ObjectId(mealId) },
        { $inc: { reviews_count: -1 } }
      );
      res.send({ result, decrease });
    });

    app.patch("/reviews", verifyToken, async (req, res) => {
      const { id, review } = req.body;
      const result = await reviewCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { review: review } }
      );
      res.send(result);
    });

    //! requestedMeals api

    app.post("/requestedMeals", verifyToken, async (req, res) => {
      const newRequest = req.body;
      const result = await requestedMealsCollection.insertOne(newRequest);
      res.send(result);
    });

    app.get("/requestedMeals", verifyToken, async (req, res) => {
      const result = await requestedMealsCollection.find().toArray();
      res.send(result);
    });

    app.get("/requestedMeals/paginate", verifyToken, async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const meals = await requestedMealsCollection
          .find()
          .skip(skip)
          .limit(limit)
          .toArray();
        const totalMeals = await requestedMealsCollection.countDocuments();
        res.status(200).send({
          meals,
          totalMeals,
          currentPage: page,
          totalPages: Math.ceil(totalMeals / limit),
        });
      } catch (error) {
        console.error("Error while paginating meals:", error.message);
        res
          .status(500)
          .send({ message: "An error occurred while fetching meals." });
      }
    });

    app.delete("/requestedMeals/:id", verifyToken, async (req, res) => {
      const { id } = req.params;
      const result = await requestedMealsCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    app.patch(
      "/requestedMeals/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;
        const result = await requestedMealsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: "Delivered" } }
        );
        res.send(result);
      }
    );

    // check if requested
    app.get("/requestedMeals/check", async (req, res) => {
      const { userEmail, mealId } = req.query;
      const query = {
        "requester.email": userEmail,
        "requestedMeal.id": mealId,
      };
      const result = await requestedMealsCollection.findOne(query);
      res.send(result);
    });

    // get meals requested by a user
    app.get("/requestedMeals/:email", verifyToken, async (req, res) => {
      try {
        const { email } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const meals = await requestedMealsCollection
          .find({ "requester.email": email })
          .skip(skip)
          .limit(limit)
          .toArray();
        const totalMeals = await requestedMealsCollection.countDocuments();
        res.status(200).send({
          meals,
          totalPayments: totalMeals,
          currentPage: page,
          totalPages: Math.ceil(totalMeals / limit),
        });
      } catch (error) {
        console.error("Error while paginating meals:", error.message);
        res
          .status(500)
          .send({ message: "An error occurred while fetching meals." });
      }
    });

    // ! payments api
    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price) * 100;
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "bdt",
        payment_method_types: ["card"],
      });
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    // post a payment
    app.post("/payments", verifyToken, async (req, res) => {
      const payment = req.body;
      const { membership, userEmail } = payment;
      const result = await paymentCollection.insertOne(payment);
      // change the badge of the user
      const update = await userCollection.updateOne(
        { email: userEmail },
        { $set: { badge: membership } }
      );
      res.send({ result, update });
    });

    // get payment history for one user
    app.get("/payments/:email", verifyToken, async (req, res) => {
      try {
        const { email } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const payments = await paymentCollection
          .find({ userEmail: email })
          .skip(skip)
          .limit(limit)
          .toArray();
        const totalPayments = await paymentCollection.countDocuments({
          userEmail: email,
        });
        res.status(200).send({
          payments,
          totalPayments,
          currentPage: page,
          totalPages: Math.ceil(totalPayments / limit),
        });
      } catch (error) {
        console.error("Error while paginating meals:", error.message);
        res
          .status(500)
          .send({ message: "An error occurred while fetching meals." });
      }
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
