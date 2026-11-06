Put your database provider's CA certificate here.

Aiven: open your PostgreSQL service in the Aiven console -> Overview -> "CA certificate" -> Download.
Save the file as:  certs/ca.pem
Then in .env add:  PGSSL_CA=certs/ca.pem

The CA certificate is public (it is not a secret), but never put your database password in this folder.
