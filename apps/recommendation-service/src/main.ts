import express from "express";
import cookieParser from "cookie-parser";
import router from "./routes/routes";

const app = express();

app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));
app.use(cookieParser());

app.get('/', (req, res) => {
  res.send({ message: 'Welcome to recommendation-service!' });
});

app.get('/api', (req, res) => {
  res.send({ message: 'Welcome to recommendation-service!' });
});

app.use("/api", router);

const port = process.env.PORT || 8686;
const server = app.listen(port, () => {
  console.log(`Listening at http://localhost:${port}`);
});
server.on('error', console.error);
