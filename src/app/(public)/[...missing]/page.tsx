// Any address no route matches: a 404 that keeps the public header and footer ((public)/not-found).
import { notFound } from "next/navigation";

export default function UnknownAddress(): never {
  notFound();
}
