{ pkgs, ... }:
{
  dotenv.enable = true;

  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_24; # latest LTS at scaffold time — bump on new even-numbered LTS
    bun = {
      enable = true;
      install.enable = true;
    };
  };

  services.postgres = {
    enable = true;
    package = pkgs.postgresql_18;
    listen_addresses = "127.0.0.1";
    port = 5432;
    initialDatabases = [
      {
        name = "palamedes";
        user = "palamedes";
        pass = "palamedes";
      }
    ];
    # Prisma migrate dev creates a shadow DB; the app role must have CREATEDB.
    initialScript = ''
      DO $$
      BEGIN
        IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'palamedes') THEN
          ALTER ROLE "palamedes" WITH CREATEDB;
        ELSE
          CREATE ROLE "palamedes" WITH LOGIN PASSWORD 'palamedes' CREATEDB;
        END IF;
      END
      $$;
    '';
  };
}
